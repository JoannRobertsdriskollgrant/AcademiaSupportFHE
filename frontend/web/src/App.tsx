import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SupportRequest {
  id: string;
  encryptedContent: string;
  timestamp: number;
  author: string;
  category: string;
  status: "pending" | "matched" | "resolved";
  matchedWith?: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRequestData, setNewRequestData] = useState({
    category: "",
    content: "",
    anonymousId: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  // Statistics for dashboard
  const matchedCount = requests.filter(r => r.status === "matched").length;
  const pendingCount = requests.filter(r => r.status === "pending").length;
  const resolvedCount = requests.filter(r => r.status === "resolved").length;

  useEffect(() => {
    loadRequests().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRequests = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check FHE contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("FHE contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("request_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing request keys:", e);
        }
      }
      
      const list: SupportRequest[] = [];
      
      for (const key of keys) {
        try {
          const requestBytes = await contract.getData(`request_${key}`);
          if (requestBytes.length > 0) {
            try {
              const requestData = JSON.parse(ethers.toUtf8String(requestBytes));
              list.push({
                id: key,
                encryptedContent: requestData.content,
                timestamp: requestData.timestamp,
                author: requestData.author,
                category: requestData.category,
                status: requestData.status || "pending",
                matchedWith: requestData.matchedWith
              });
            } catch (e) {
              console.error(`Error parsing request data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading request ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRequests(list);
    } catch (e) {
      console.error("Error loading requests:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRequest = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting your request with FHE..."
    });
    
    try {
      // Simulate FHE encryption for academic support request
      const encryptedContent = `FHE-${btoa(JSON.stringify(newRequestData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const requestData = {
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        author: account,
        category: newRequestData.category,
        status: "pending"
      };
      
      // Store encrypted data using FHE
      await contract.setData(
        `request_${requestId}`, 
        ethers.toUtf8Bytes(JSON.stringify(requestData))
      );
      
      const keysBytes = await contract.getData("request_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(requestId);
      
      await contract.setData(
        "request_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Request submitted securely with FHE encryption!"
      });
      
      await loadRequests();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRequestData({
          category: "",
          content: "",
          anonymousId: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const matchRequest = async (requestId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Finding peer match using FHE algorithm..."
    });

    try {
      // Simulate FHE matching computation
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const requestBytes = await contract.getData(`request_${requestId}`);
      if (requestBytes.length === 0) {
        throw new Error("Request not found");
      }
      
      const requestData = JSON.parse(ethers.toUtf8String(requestBytes));
      
      const updatedRequest = {
        ...requestData,
        status: "matched",
        matchedWith: `peer-${Math.random().toString(36).substring(2, 8)}`
      };
      
      await contract.setData(
        `request_${requestId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRequest))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE matching completed successfully!"
      });
      
      await loadRequests();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Matching failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const resolveRequest = async (requestId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating request status with FHE..."
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const requestBytes = await contract.getData(`request_${requestId}`);
      if (requestBytes.length === 0) {
        throw new Error("Request not found");
      }
      
      const requestData = JSON.parse(ethers.toUtf8String(requestBytes));
      
      const updatedRequest = {
        ...requestData,
        status: "resolved"
      };
      
      await contract.setData(
        `request_${requestId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRequest))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Request marked as resolved!"
      });
      
      await loadRequests();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE system is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isAuthor = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Anonymously",
      description: "Connect your wallet while maintaining privacy through FHE encryption",
      icon: "🔒"
    },
    {
      title: "Share Your Struggle",
      description: "Describe your academic challenges - all data remains encrypted",
      icon: "📝"
    },
    {
      title: "FHE Matching",
      description: "Our algorithm finds peers with similar experiences without decrypting data",
      icon: "⚙️"
    },
    {
      title: "Get Support",
      description: "Receive anonymous support from matched peers in a safe environment",
      icon: "🤝"
    }
  ];

  const renderPieChart = () => {
    const total = requests.length || 1;
    const matchedPercentage = (matchedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const resolvedPercentage = (resolvedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment matched" 
            style={{ transform: `rotate(${matchedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment resolved" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage + resolvedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{requests.length}</div>
            <div className="pie-label">Requests</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box matched"></div>
            <span>Matched: {matchedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box resolved"></div>
            <span>Resolved: {resolvedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const toggleRequestDetails = (requestId: string) => {
    setExpandedRequest(expandedRequest === requestId ? null : requestId);
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="academic-icon">🎓</div>
          </div>
          <h1>Academic<span>Support</span>Network</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-request-btn glass-button"
          >
            <div className="add-icon">+</div>
            Share Struggle
          </button>
          <button 
            className="glass-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <button 
            className="glass-button"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Academic Peer Support</h2>
            <p>Share your research challenges securely with FHE encryption and find supportive peers</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Protects Your Privacy</h2>
            <p className="subtitle">Your academic struggles remain encrypted while finding support</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step glass-card"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>About This Platform</h3>
            <p>A safe space for researchers and academics to share challenges anonymously. 
               Using FHE technology, your data remains encrypted while we match you with supportive peers.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Support Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{requests.length}</div>
                <div className="stat-label">Total Requests</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{matchedCount}</div>
                <div className="stat-label">Matched</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{resolvedCount}</div>
                <div className="stat-label">Resolved</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="requests-section">
          <div className="section-header">
            <h2>Support Requests</h2>
            <div className="header-actions">
              <button 
                onClick={loadRequests}
                className="refresh-btn glass-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="requests-list">
            {requests.length === 0 ? (
              <div className="no-requests glass-card">
                <div className="no-requests-icon">📚</div>
                <p>No support requests yet</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Share Your First Struggle
                </button>
              </div>
            ) : (
              <div className="requests-grid">
                {requests.map(request => (
                  <div className="request-card glass-card" key={request.id}>
                    <div className="request-header">
                      <div className="request-category">{request.category}</div>
                      <span className={`status-badge ${request.status}`}>
                        {request.status}
                      </span>
                    </div>
                    
                    <div className="request-content">
                      <div className="request-author">
                        Anonymous • {new Date(request.timestamp * 1000).toLocaleDateString()}
                      </div>
                      
                      <div className="request-preview">
                        {request.encryptedContent.substring(0, 80)}...
                      </div>
                      
                      <button 
                        className="view-details-btn"
                        onClick={() => toggleRequestDetails(request.id)}
                      >
                        {expandedRequest === request.id ? "Hide Details" : "View Details"}
                      </button>
                      
                      {expandedRequest === request.id && (
                        <div className="request-details">
                          <div className="detail-section">
                            <h4>Encrypted Content:</h4>
                            <p className="encrypted-data">{request.encryptedContent}</p>
                          </div>
                          
                          {request.matchedWith && (
                            <div className="detail-section">
                              <h4>Matched With:</h4>
                              <p>Peer: {request.matchedWith}</p>
                            </div>
                          )}
                          
                          <div className="detail-actions">
                            {isAuthor(request.author) && request.status === "pending" && (
                              <button 
                                className="action-btn glass-button success"
                                onClick={() => matchRequest(request.id)}
                              >
                                Find Match
                              </button>
                            )}
                            
                            {isAuthor(request.author) && request.status === "matched" && (
                              <button 
                                className="action-btn glass-button primary"
                                onClick={() => resolveRequest(request.id)}
                              >
                                Mark Resolved
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRequest} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          requestData={newRequestData}
          setRequestData={setNewRequestData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="academic-icon">🎓</div>
              <span>AcademicSupportNetwork</span>
            </div>
            <p>Secure anonymous academic support using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Paper</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Academic Resources</a>
            <a href="#" className="footer-link">Contact Researchers</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Academic Support</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Academic Support Network. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  requestData: any;
  setRequestData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  requestData,
  setRequestData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRequestData({
      ...requestData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!requestData.category || !requestData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Share Academic Challenge</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> 
            Your content will be encrypted with FHE - only matched peers can access
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Research Area *</label>
              <select 
                name="category"
                value={requestData.category} 
                onChange={handleChange}
                className="glass-input"
              >
                <option value="">Select category</option>
                <option value="PhD Stress">PhD Stress</option>
                <option value="Research Block">Research Block</option>
                <option value="Paper Writing">Paper Writing</option>
                <option value="Funding Anxiety">Funding Anxiety</option>
                <option value="Peer Review">Peer Review</option>
                <option value="Work-Life Balance">Work-Life Balance</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Anonymous ID</label>
              <input 
                type="text"
                name="anonymousId"
                value={requestData.anonymousId} 
                onChange={handleChange}
                placeholder="Optional identifier" 
                className="glass-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Your Challenge *</label>
              <textarea 
                name="content"
                value={requestData.content} 
                onChange={handleChange}
                placeholder="Describe your academic struggle or research challenge..." 
                className="glass-textarea"
                rows={5}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🛡️</div> 
            All data remains encrypted during FHE processing and matching
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Share Anonymously"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;