// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AcademiaSupportFHE is SepoliaConfig {
    struct EncryptedSupportRequest {
        uint256 id;
        euint32 encryptedIssue;
        euint32 encryptedField;
        euint32 encryptedUserId;
        uint256 timestamp;
    }
    
    struct DecryptedSupportRequest {
        string issue;
        string field;
        string userId;
        bool isMatched;
    }

    uint256 public requestCount;
    mapping(uint256 => EncryptedSupportRequest) public encryptedRequests;
    mapping(uint256 => DecryptedSupportRequest) public decryptedRequests;
    
    mapping(string => euint32) private encryptedFieldStats;
    string[] private fieldList;
    
    mapping(uint256 => uint256) private requestToSupportId;
    
    event SupportRequestSubmitted(uint256 indexed id, uint256 timestamp);
    event MatchingRequested(uint256 indexed id);
    event SupportRequestMatched(uint256 indexed id);
    
    modifier onlyRequester(uint256 requestId) {
        _;
    }
    
    function submitEncryptedSupportRequest(
        euint32 encryptedIssue,
        euint32 encryptedField,
        euint32 encryptedUserId
    ) public {
        requestCount += 1;
        uint256 newId = requestCount;
        
        encryptedRequests[newId] = EncryptedSupportRequest({
            id: newId,
            encryptedIssue: encryptedIssue,
            encryptedField: encryptedField,
            encryptedUserId: encryptedUserId,
            timestamp: block.timestamp
        });
        
        decryptedRequests[newId] = DecryptedSupportRequest({
            issue: "",
            field: "",
            userId: "",
            isMatched: false
        });
        
        emit SupportRequestSubmitted(newId, block.timestamp);
    }
    
    function requestPeerMatching(uint256 requestId) public onlyRequester(requestId) {
        EncryptedSupportRequest storage req = encryptedRequests[requestId];
        require(!decryptedRequests[requestId].isMatched, "Already matched");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(req.encryptedIssue);
        ciphertexts[1] = FHE.toBytes32(req.encryptedField);
        ciphertexts[2] = FHE.toBytes32(req.encryptedUserId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.matchPeers.selector);
        requestToSupportId[reqId] = requestId;
        
        emit MatchingRequested(requestId);
    }
    
    function matchPeers(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 supportId = requestToSupportId[requestId];
        require(supportId != 0, "Invalid request");
        
        EncryptedSupportRequest storage eReq = encryptedRequests[supportId];
        DecryptedSupportRequest storage dReq = decryptedRequests[supportId];
        require(!dReq.isMatched, "Already matched");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory issue, string memory field, string memory userId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dReq.issue = issue;
        dReq.field = field;
        dReq.userId = userId;
        dReq.isMatched = true;
        
        if (FHE.isInitialized(encryptedFieldStats[dReq.field]) == false) {
            encryptedFieldStats[dReq.field] = FHE.asEuint32(0);
            fieldList.push(dReq.field);
        }
        encryptedFieldStats[dReq.field] = FHE.add(
            encryptedFieldStats[dReq.field], 
            FHE.asEuint32(1)
        );
        
        emit SupportRequestMatched(supportId);
    }
    
    function getDecryptedRequest(uint256 requestId) public view returns (
        string memory issue,
        string memory field,
        string memory userId,
        bool isMatched
    ) {
        DecryptedSupportRequest storage r = decryptedRequests[requestId];
        return (r.issue, r.field, r.userId, r.isMatched);
    }
    
    function getEncryptedFieldStats(string memory field) public view returns (euint32) {
        return encryptedFieldStats[field];
    }
    
    function requestFieldStatsDecryption(string memory field) public {
        euint32 stats = encryptedFieldStats[field];
        require(FHE.isInitialized(stats), "Field not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptFieldStats.selector);
        requestToSupportId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(field)));
    }
    
    function decryptFieldStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 fieldHash = requestToSupportId[requestId];
        string memory field = getFieldFromHash(fieldHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getFieldFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < fieldList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(fieldList[i]))) == hash) {
                return fieldList[i];
            }
        }
        revert("Field not found");
    }
    
    function findCompatiblePeers(
        uint256 requestId,
        uint256[] memory peerRequestIds
    ) public view returns (uint256[] memory compatiblePeers) {
        DecryptedSupportRequest storage requester = decryptedRequests[requestId];
        require(requester.isMatched, "Request not processed");
        
        uint256 count = 0;
        for (uint256 i = 0; i < peerRequestIds.length; i++) {
            DecryptedSupportRequest storage peer = decryptedRequests[peerRequestIds[i]];
            if (peer.isMatched && 
                keccak256(abi.encodePacked(peer.field)) == keccak256(abi.encodePacked(requester.field)) &&
                keccak256(abi.encodePacked(peer.userId)) != keccak256(abi.encodePacked(requester.userId))) {
                count++;
            }
        }
        
        compatiblePeers = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < peerRequestIds.length; i++) {
            DecryptedSupportRequest storage peer = decryptedRequests[peerRequestIds[i]];
            if (peer.isMatched && 
                keccak256(abi.encodePacked(peer.field)) == keccak256(abi.encodePacked(requester.field)) &&
                keccak256(abi.encodePacked(peer.userId)) != keccak256(abi.encodePacked(requester.userId))) {
                compatiblePeers[index] = peerRequestIds[i];
                index++;
            }
        }
        return compatiblePeers;
    }
    
    function calculateSimilarityScore(
        string memory issue1,
        string memory issue2
    ) public pure returns (uint256) {
        // Simplified similarity calculation
        // In real implementation, this would use NLP techniques
        return keccak256(abi.encodePacked(issue1)) == keccak256(abi.encodePacked(issue2)) ? 100 : 50;
    }
}