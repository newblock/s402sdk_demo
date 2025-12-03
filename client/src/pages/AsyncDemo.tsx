
import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { S402Client } from '../../../server/sdk/client';

const S402_FACILITATOR = '0x605c5c8d83152bd98ecAc9B77a845349DA3c48a3';
const USD1_TOKEN = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';

const USD1_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address owner) external view returns (uint256)',
  'function name() external view returns (string)',
  'function version() external view returns (string)'
];

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function AsyncDemo() {
  const [recipient, setRecipient] = useState('0xb3b977509ae61cd17c618aa929be867b563c315f');
  const [amount, setAmount] = useState('0.001');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [usd1Balance, setUsd1Balance] = useState('');
  const [bnbBalance, setBnbBalance] = useState('');
  const [needsApproval, setNeedsApproval] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [asyncMode, setAsyncMode] = useState(true);
  const [timerVisible, setTimerVisible] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);
  const [connectedSigner, setConnectedSigner] = useState<ethers.Signer | null>(null);
  const [lastResponseTime, setLastResponseTime] = useState<{async: number, sync: number}>({async: 0, sync: 0});
  const { toast } = useToast();
  
  // Use useRef to ensure timer can be stopped correctly
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerSecondsRef = useRef<number>(0);

  // Clean up timer when component unmounts
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const checkAndSwitchNetwork = async (): Promise<ethers.BrowserProvider> => {
    if (!window.ethereum) {
      throw new Error('Please install MetaMask');
    }

    let provider = new ethers.BrowserProvider(window.ethereum);
    let network = await provider.getNetwork();
    const bscChainId = BigInt(56);

    if (network.chainId !== bscChainId) {
      toast({ title: "Switching Network", description: "Switching to BNB Chain..." });
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x38' }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          // Let user add the network manually in their wallet - wallet will use its own RPC
          throw new Error('Please add BNB Smart Chain (Chain ID: 56) to your wallet manually');
        } else {
          throw new Error(`Failed to switch to BNB Chain: ${switchError.message}`);
        }
      }

      provider = new ethers.BrowserProvider(window.ethereum);
      network = await provider.getNetwork();
      
      if (network.chainId !== bscChainId) {
        throw new Error('Network switch failed - please manually switch to BNB Chain in MetaMask');
      }
    }

    return provider;
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        toast({ title: "MetaMask Not Found", description: "Please install MetaMask", variant: "destructive" });
        return;
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = await checkAndSwitchNetwork();
      
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      setWalletAddress(address);
      setConnectedSigner(signer); // Save connected signer
      
      const bnbBal = await provider.getBalance(address);
      setBnbBalance(ethers.formatEther(bnbBal));
      
      const usd1Contract = new ethers.Contract(USD1_TOKEN, USD1_ABI, provider);
      const bal = await usd1Contract.balanceOf(address);
      setUsd1Balance(ethers.formatUnits(bal, 18));
      
      const allowance = await usd1Contract.allowance(address, S402_FACILITATOR);
      const minAllowance = ethers.parseUnits('1', 18);
      if (allowance < minAllowance) {
        setNeedsApproval(true);
        setIsApproved(false);
        toast({ title: "Wallet Connected", description: "Please approve USD1 spending first." });
      } else {
        setNeedsApproval(false);
        setIsApproved(true);
        toast({ title: "Wallet Connected", description: "Ready to send payments!" });
      }
    } catch (error: any) {
      console.error('Wallet connection error:', error);
      const errorMessage = error.reason || error.message || 'Unknown error occurred';
      toast({ 
        title: "Connection Failed", 
        description: errorMessage, 
        variant: "destructive" 
      });
    }
  };

  const approveUSD1 = async () => {
    try {
      if (!window.ethereum) {
        toast({ title: "MetaMask Not Found", description: "Please install MetaMask", variant: "destructive" });
        return;
      }

      setLoading(true);
      const provider = await checkAndSwitchNetwork();
      
      toast({ title: "Approving", description: "Sign the approval transaction..." });
      const signer = await provider.getSigner();
      const usd1Contract = new ethers.Contract(USD1_TOKEN, USD1_ABI, signer);
      
      const maxApproval = ethers.parseUnits('1000000', 18);
      const tx = await usd1Contract.approve(S402_FACILITATOR, maxApproval);
      
      toast({ title: "Confirming", description: "Waiting for confirmation..." });
      await tx.wait();
      
      setNeedsApproval(false);
      setIsApproved(true);
      toast({ title: "Approved!", description: "USD1 approved! You can now send payments with 1 signature." });
      setLoading(false);
    } catch (error: any) {
      console.error('Approval error:', error);
      const errorMessage = error.reason || error.message || 'Unknown error occurred';
      toast({ 
        title: "Approval Failed", 
        description: errorMessage, 
        variant: "destructive" 
      });
      setLoading(false);
    }
  };

  // Start timer
  const startTimer = () => {
    setTimerVisible(true);
    setTimerSeconds(0);
    timerSecondsRef.current = 0;
    
    // Clear any existing timer first
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds, keep decimals
      timerSecondsRef.current = elapsed;
      setTimerSeconds(elapsed);
    }, 100); // Update every 100ms for better precision
    timerIntervalRef.current = interval;
    setTimerInterval(interval);
  };

  // Stop timer
  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      setTimerInterval(null);
      
      // Record response time
      const mode = asyncMode ? 'async' : 'sync';
      setLastResponseTime(prev => ({
        ...prev,
        [mode]: timerSecondsRef.current
      }));
    }
  };

  // Close timer dialog
  const closeTimerDialog = () => {
    stopTimer();
    setTimerVisible(false);
    setTimerSeconds(0);
    timerSecondsRef.current = 0;
  };

  const sendPayment = async () => {
    try {
      if (!window.ethereum) {
        toast({ title: "MetaMask Not Found", description: "Please install MetaMask", variant: "destructive" });
        return;
      }

      setLoading(true);
      const provider = await checkAndSwitchNetwork();
      
      // Use saved signer to avoid repeated authorization
      const signer = connectedSigner || await provider.getSigner();
      const from = await signer.getAddress();
      
      // Check if allowance is sufficient to avoid permit signature
      const usd1Contract = new ethers.Contract(USD1_TOKEN, USD1_ABI, provider);
      const allowance = await usd1Contract.allowance(from, S402_FACILITATOR);
      const paymentAmount = ethers.parseUnits(amount, 18);
      
      if (allowance < paymentAmount) {
        toast({
          title: "Insufficient Allowance",
          description: "Please approve sufficient USD1 allowance first",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }
      
      // Create S402Client instance
      const client = new S402Client({
        baseUrl: window.location.origin,
        provider,
        signer,
        facilitator: S402_FACILITATOR,
        token: USD1_TOKEN,
        chainId: 56,
        autoSettle: true,
        asyncMode: asyncMode, // Enable async mode for immediate response
      });


      // Start timer immediately after authorization
      startTimer();
      
      // For async mode: use S402Client to handle payment automatically
      if (asyncMode) {
        toast({ title: "Sending Payment", description: "Using S402Client to handle payment..." });
        
        const response = await client.request('/api/v1/tool/example-async', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payload: {
              test: "async payment demo",
              amount: amount,
              recipient: recipient,
            },
          }),
        });


        setApiResponse({
          status: 200,
          data: response,
          endpoint: '/api/v1/tool/example-async'
        });
        
        // Set transaction hash if available from the response
        if (response.txHash) {
          setTxHash(response.txHash);
        }

        toast({ title: "Success!", description: "Payment submitted and API access granted!" });
        
        // Update balance in background
        const usd1Contract = new ethers.Contract(USD1_TOKEN, USD1_ABI, provider);
        const bal = await usd1Contract.balanceOf(from);
        setUsd1Balance(ethers.formatUnits(bal, 18));
        
        stopTimer(); // Stop timer and record time
        setLoading(false);
        
      } else {
        // Sync mode: use S402Client for sync payment
        toast({ title: "Sending Payment", description: "Using S402Client for sync payment..." });
        
        const response = await client.request('/api/v1/tool/example', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payload: {
              test: "sync payment demo",
              amount: amount,
              recipient: recipient,
            },
          }),
        });

        setApiResponse({
          status: 200,
          data: response,
          endpoint: '/api/v1/tool/example'
        });
        
        // Set transaction hash if available from the response
        if (response.txHash) {
          setTxHash(response.txHash);
        }

        toast({ title: "Success!", description: "Payment complete!" });
        stopTimer(); // Stop timer and record time
        
        const usd1Contract = new ethers.Contract(USD1_TOKEN, USD1_ABI, provider);
        const bal = await usd1Contract.balanceOf(from);
        setUsd1Balance(ethers.formatUnits(bal, 18));
        
        setLoading(false);
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      const errorMessage = error.reason || error.message || 'Unknown error occurred';
      toast({
        title: "Payment Failed",
        description: errorMessage,
        variant: "destructive"
      });
      setLoading(false);
      stopTimer(); // Also stop timer on error
    }
  };

  const testAsyncAPI = async () => {
    try {
      setLoading(true);
      setApiResponse(null);
      
      const endpoint = asyncMode ? '/api/v1/tool/example-async' : '/api/v1/tool/example';
      
      toast({ title: "Testing API", description: `Calling ${endpoint}...` });
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { test: "async demo" } }),
      });
      
      const data = await response.json();
      
      setApiResponse({
        status: response.status,
        data: data,
        endpoint: endpoint
      });
      
      if (response.status === 402) {
        toast({ title: "Payment Required", description: "API returned 402 as expected" });
      } else if (response.status === 200) {
        toast({ title: "Success!", description: "API call successful!" });
      }
      
      setLoading(false);
    } catch (error: any) {
      console.error('API test error:', error);
      toast({ 
        title: "API Test Failed", 
        description: error.message, 
        variant: "destructive" 
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="container mx-auto max-w-4xl py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-primary">SORA S402 Async Demo</h1>
          <p className="text-muted-foreground">
            Test asynchronous transaction verification with immediate response
          </p>
        </div>

        {/* Mode Selection */}
        <Card className="mb-6 border-blue-500/30">
          <CardHeader>
            <h2 className="text-xl font-bold">Verification Mode</h2>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-4">
              <Button
                variant={asyncMode ? "default" : "outline"}
                onClick={() => setAsyncMode(true)}
              >
                Async Mode
              </Button>
              <Button
                variant={!asyncMode ? "default" : "outline"}
                onClick={() => setAsyncMode(false)}
              >
                Sync Mode
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {asyncMode ? (
                <>
                  <p><strong>Async Mode:</strong> Immediate response, background blockchain verification</p>
                  <p>Suitable for micropayment and regular API calls, user experience-first scenarios, providing sufficient security through signature verification.</p>
                </>
              ) : (
                <>
                  <p><strong>Sync Mode:</strong> Waits for blockchain confirmation before responding.</p>
                  <p>Suitable for financial function, sensitive data access, and scenarios requiring highest security guarantees.</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* API Test */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-xl font-bold">Test API Endpoint</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={testAsyncAPI}
                  disabled={loading}
                >
                  {loading ? 'Testing...' : `Test ${asyncMode ? 'Async' : 'Sync'} API`}
                </Button>
                <span className="text-sm text-muted-foreground">
                  Endpoint: {asyncMode ? '/api/v1/tool/example-async' : '/api/v1/tool/example'}
                </span>
              </div>
              
              {apiResponse && (
                <div className="bg-muted p-4 rounded border">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold">Status:</span>
                    <span className={`px-2 py-1 rounded text-xs ${
                      apiResponse.status === 200 ? 'bg-green-500 text-white' :
                      apiResponse.status === 402 ? 'bg-yellow-500 text-white' :
                      'bg-red-500 text-white'
                    }`}>
                      {apiResponse.status}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {apiResponse.endpoint}
                    </span>
                  </div>
                  <pre className="text-sm overflow-x-auto bg-black/10 p-2 rounded">
                    {JSON.stringify(apiResponse.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wallet Connection */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-xl font-bold">1. Connect Wallet</h2>
          </CardHeader>
          <CardContent>
            {!walletAddress ? (
              <Button onClick={connectWallet}>
                Connect MetaMask
              </Button>
            ) : (
              <div>
                <p className="text-green-600 dark:text-green-400 mb-3">
                  Connected: {walletAddress}
                </p>
                <div className="space-y-2 bg-muted p-4 rounded border">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">USD1 Balance:</span>
                    <span className="font-mono font-bold">
                      {parseFloat(usd1Balance).toFixed(4)} USD1
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">BNB Balance (for gas):</span>
                    <span className="font-mono font-bold">
                      {parseFloat(bnbBalance).toFixed(6)} BNB
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Approval Section */}
        {walletAddress && needsApproval && (
          <Card className="mb-6 border-primary">
            <CardHeader>
              <h2 className="text-xl font-bold text-primary">2. Approve USD1</h2>
            </CardHeader>
            <CardContent>
              <Button
                onClick={approveUSD1}
                disabled={loading}
              >
                {loading ? 'Approving...' : 'Approve USD1'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Payment Form */}
        {walletAddress && isApproved && (
          <Card className="mb-6">
            <CardHeader>
              <h2 className="text-xl font-bold">3. Send Payment</h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-2">Recipient Address</label>
                  <Input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="font-mono"
                    placeholder="0x..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">Amount (USD1)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.01"
                  />
                </div>

                <Button
                  onClick={sendPayment}
                  disabled={loading || !recipient || !amount}
                >
                  {loading ? 'Processing...' : 'Send Payment (1 Signature)'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transaction Result */}
        {txHash && (
          <Card className="mb-6 border-green-500">
            <CardHeader>
              <h3 className="text-lg font-bold">SUCCESS!</h3>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">Transaction Hash:</p>
              <a
                href={`https://bscscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover-elevate font-mono text-sm break-all"
              >
                {txHash}
              </a>
              <p className="text-muted-foreground mt-4">
                Your payment has been settled on BNB Chain!
              </p>
            </CardContent>
          </Card>
        )}

        {/* Response Time Comparison */}
        {(lastResponseTime.async > 0 || lastResponseTime.sync > 0) && (
          <Card className="border-green-500/30">
            <CardHeader>
              <h3 className="text-lg font-bold">Response Time Comparison</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Async Mode Response Time (mainly wallet operation time):</span>
                  <span className="font-mono font-bold text-green-600">
                    {lastResponseTime.async > 0 ? `${lastResponseTime.async.toFixed(4)} s` : 'Not tested'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Sync Mode Response Time:</span>
                  <span className="font-mono font-bold text-blue-600">
                    {lastResponseTime.sync > 0 ? `${lastResponseTime.sync.toFixed(4)} s` : 'Not tested'}
                  </span>
                </div>
                {lastResponseTime.async > 0 && lastResponseTime.sync > 0 && (
                  <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-sm font-medium">Response Time Difference:</span>
                    <span className="font-mono font-bold text-purple-600">
                      {Math.abs(lastResponseTime.async - lastResponseTime.sync).toFixed(4)} s
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Box */}
        <Card className="border-blue-500/30">
          <CardHeader>
            <h3 className="text-lg font-bold">Async Verification Benefits</h3>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><strong>Immediate Response:</strong> API returns immediately after signature verification</li>
              <li><strong>:</strong> Blockchain confirmation happens in background</li>
              <li><strong>Better UX:</strong> Users don't wait for blockchain confirmations</li>
              <li><strong>Same Security:</strong> All validation rules still apply (txHash required)</li>
              <li><strong>Flexible:</strong> Switch between sync and async modes easily</li>
            </ul>
          </CardContent>
        </Card>

        {/* Timer Dialog */}
        <Dialog open={timerVisible} onOpenChange={closeTimerDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-center">Blockchain Processing</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center space-y-4 py-6">
              <div className="text-4xl font-bold text-primary">
                {timerSeconds.toFixed(4)} s
              </div>
              <div className="text-sm text-muted-foreground text-center">
                <p>Waiting for blockchain confirmation...</p>
                <p>Transaction submitted, waiting for network confirmation</p>
              </div>
              <div className="w-full max-w-xs bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((timerSeconds / 10) * 100, 100)}%` }}
                />
              </div>
              <Button
                onClick={closeTimerDialog}
                variant="outline"
                className="mt-4"
              >
                Close Timer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}