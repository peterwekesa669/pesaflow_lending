const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ========== SETTINGS ==========
// SET THIS TO true FOR TESTING (no real money)
// SET THIS TO false FOR REAL M-PESA (requires real credentials)
const TEST_MODE = true;  // ← CHANGE TO false WHEN READY FOR REAL M-PESA

// In-memory storage
const users = [];
const loans = [];
let nextUserId = 1;
let nextLoanId = 1;

// ========== M-PESA CONFIGURATION (only used when TEST_MODE = false) ==========
const MPESA_CONFIG = {
    consumerKey: 'XumLmTm2fOQ2Lf9KG5ibb6QYE4CmzxjMuvHOIGfGCiWnZHA',
    consumerSecret: 'j9T3TiANLj0HAosJtqYrhwpoMfleiv5Hd64SirF8mQSMZall7T863kVX7Wg05N',
    passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
    shortcode: '174379',
    environment: 'sandbox'
};

// ========== M-PESA HELPER FUNCTIONS (for real mode) ==========
async function getMpesaToken() {
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
    try {
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('M-Pesa token error:', error.message);
        return null;
    }
}

function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    } else if (!cleaned.startsWith('254')) {
        cleaned = '254' + cleaned;
    }
    return cleaned;
}

// ========== M-PESA ROUTE ==========
app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
        const { phone, amount, loanId, userId } = req.body;
        
        console.log('💰 Payment request:', { phone, amount, loanId, userId });
        
        // Find the loan
        const loan = loans.find(l => l.id == loanId && l.userId == userId);
        if (!loan) {
            return res.status(404).json({ error: 'Loan not found' });
        }
        
        if (amount > loan.remainingAmount) {
            return res.status(400).json({ error: `Amount exceeds remaining balance of KES ${loan.remainingAmount}` });
        }
        
        if (TEST_MODE) {
            // ========== TEST MODE - Simulate successful payment ==========
            console.log('🧪 TEST MODE: Simulating payment of KES', amount);
            
            // Update loan
            loan.paidAmount = (loan.paidAmount || 0) + amount;
            loan.remainingAmount -= amount;
            
            if (loan.remainingAmount <= 0) {
                loan.status = 'completed';
                loan.remainingAmount = 0;
            }
            
            res.json({ 
                success: true, 
                message: `✅ TEST MODE: Payment of KES ${amount} successful! Remaining: KES ${loan.remainingAmount}`,
                testMode: true,
                remainingAmount: loan.remainingAmount
            });
            
        } else {
            // ========== REAL M-PESA MODE ==========
            const formattedPhone = formatPhoneNumber(phone);
            const token = await getMpesaToken();
            
            if (!token) {
                return res.status(500).json({ error: 'M-Pesa service unavailable. Please try again.' });
            }
            
            const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
            const password = Buffer.from(`${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`).toString('base64');
            
            const data = {
                BusinessShortCode: MPESA_CONFIG.shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: Math.round(amount),
                PartyA: formattedPhone,
                PartyB: MPESA_CONFIG.shortcode,
                PhoneNumber: formattedPhone,
                CallBackURL: 'https://pesaflow-lending.onrender.com/api/mpesa/callback',
                AccountReference: `LOAN-${loanId}`,
                TransactionDesc: 'PesaFlow Loan Payment'
            };
            
            const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', data, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            loan.mpesaCheckoutID = response.data.CheckoutRequestID;
            loan.pendingPaymentAmount = amount;
            
            res.json({ 
                success: true, 
                message: 'M-Pesa prompt sent to your phone. Enter your PIN to complete payment.',
                checkoutRequestID: response.data.CheckoutRequestID
            });
        }
        
    } catch (error) {
        console.error('M-Pesa error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Payment failed. Please try again.' });
    }
});

// M-Pesa Callback (for real mode only)
app.post('/api/mpesa/callback', (req, res) => {
    const { Body } = req.body;
    console.log('M-Pesa callback received');
    
    if (Body?.stkCallback?.ResultCode === 0) {
        const checkoutRequestID = Body.stkCallback.CheckoutRequestID;
        const loan = loans.find(l => l.mpesaCheckoutID === checkoutRequestID);
        
        if (loan) {
            const paymentAmount = loan.pendingPaymentAmount || 0;
            loan.paidAmount = (loan.paidAmount || 0) + paymentAmount;
            loan.remainingAmount -= paymentAmount;
            
            if (loan.remainingAmount <= 0) {
                loan.status = 'completed';
                loan.remainingAmount = 0;
            }
            
            delete loan.mpesaCheckoutID;
            delete loan.pendingPaymentAmount;
            
            console.log(`✅ Payment recorded: KES ${paymentAmount} for loan ${loan.id}`);
        }
    }
    
    res.json({ ResultCode: 0, ResultDesc: "Success" });
});

// ========== USER ROUTES ==========
app.post('/api/register', (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        const user = { id: nextUserId++, name, email, password, phone: phone || '' };
        users.push(user);
        res.json({ success: true, user: { id: user.id, name, email } });
        console.log('✅ User registered:', email);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const user = users.find(u => u.email === email && u.password === password);
        if (user) {
            res.json({ success: true, user: { id: user.id, name: user.name, email, phone: user.phone } });
            console.log('✅ User logged in:', email);
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/check-active-loan/:userId', (req, res) => {
    const activeLoan = loans.find(l => l.userId == req.params.userId && l.status === 'active');
    res.json({ hasActiveLoan: !!activeLoan });
});

app.post('/api/loans/apply', (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        if (amount < 200 || amount > 5000) {
            return res.status(400).json({ error: 'Amount must be between KES 200 and 5000' });
        }
        
        const activeLoan = loans.find(l => l.userId == userId && l.status === 'active');
        if (activeLoan) {
            return res.status(400).json({ error: 'You have an active loan. Please repay first.' });
        }
        
        const interest = amount * 0.25;
        const totalPayable = amount + interest;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        
        const loan = {
            id: nextLoanId++,
            userId,
            amount,
            interestRate: 25,
            totalPayable,
            remainingAmount: totalPayable,
            dueDate,
            status: 'active',
            appliedDate: new Date(),
            paidAmount: 0
        };
        
        loans.push(loan);
        
        res.json({ 
            success: true, 
            loan: {
                ...loan,
                dueDate: dueDate.toLocaleDateString(),
                message: `✅ Loan approved! Pay KES ${totalPayable} by ${dueDate.toLocaleDateString()}`
            }
        });
        console.log('💰 Loan applied:', amount);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/loans/my/:userId', (req, res) => {
    try {
        const userLoans = loans.filter(l => l.userId == req.params.userId);
        res.json(userLoans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/:userId', (req, res) => {
    try {
        const userLoans = loans.filter(l => l.userId == req.params.userId);
        const totalLoans = userLoans.length;
        const activeLoans = userLoans.filter(l => l.status === 'active').length;
        const completedLoans = userLoans.filter(l => l.status === 'completed').length;
        const totalBorrowed = userLoans.reduce((sum, l) => sum + l.amount, 0);
        const totalRemaining = userLoans.reduce((sum, l) => sum + l.remainingAmount, 0);
        res.json({ totalLoans, activeLoans, completedLoans, totalBorrowed, totalRemaining });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/payments', (req, res) => {
    try {
        const { loanId, amount } = req.body;
        const loan = loans.find(l => l.id == loanId);
        
        if (!loan) return res.status(404).json({ error: 'Loan not found' });
        if (amount > loan.remainingAmount) return res.status(400).json({ error: 'Amount exceeds remaining balance' });
        
        loan.paidAmount += amount;
        loan.remainingAmount -= amount;
        
        if (loan.remainingAmount <= 0) {
            loan.status = 'completed';
            loan.remainingAmount = 0;
        }
        
        let message = `✅ Payment of KES ${amount} received. Remaining: KES ${loan.remainingAmount}`;
        if (loan.remainingAmount === 0) message = '🎉 Loan fully paid! Thank you!';
        
        res.json({ success: true, message, remainingAmount: loan.remainingAmount });
        console.log('💵 Manual payment:', amount);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ADMIN ROUTES ==========
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'admin@pesaflow.com' && password === 'admin123') {
        res.json({ success: true, admin: { name: 'Admin', role: 'admin' } });
    } else {
        res.status(401).json({ error: 'Invalid admin credentials' });
    }
});

app.get('/api/admin/users', (req, res) => {
    if (req.headers.authorization !== 'Bearer admin123') return res.status(401).json({ error: 'Unauthorized' });
    const safeUsers = users.map(u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone }));
    res.json(safeUsers);
});

app.get('/api/admin/loans', (req, res) => {
    if (req.headers.authorization !== 'Bearer admin123') return res.status(401).json({ error: 'Unauthorized' });
    const allLoans = loans.map(loan => {
        const user = users.find(u => u.id == loan.userId);
        return { ...loan, borrowerName: user?.name || 'Unknown', borrowerEmail: user?.email || 'Unknown', dueDate: loan.dueDate.toLocaleDateString() };
    });
    res.json(allLoans);
});

app.get('/api/admin/profits', (req, res) => {
    if (req.headers.authorization !== 'Bearer admin123') return res.status(401).json({ error: 'Unauthorized' });
    const completedLoans = loans.filter(l => l.status === 'completed');
    const totalLoanAmount = completedLoans.reduce((sum, l) => sum + l.amount, 0);
    const totalCollected = completedLoans.reduce((sum, l) => sum + l.paidAmount, 0);
    res.json({
        totalLoansGiven: loans.length,
        completedLoans: completedLoans.length,
        activeLoans: loans.filter(l => l.status === 'active').length,
        totalDisbursed: totalLoanAmount,
        totalCollected: totalCollected,
        totalProfit: totalCollected - totalLoanAmount,
        expectedProfit: loans.filter(l => l.status === 'active').reduce((sum, l) => sum + (l.totalPayable - l.amount), 0)
    });
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('💰 PESaFLOW LENDING APP');
    console.log('========================================');
    console.log(`📱 App running: http://localhost:${PORT}`);
    console.log('👨‍💼 Admin: admin@pesaflow.com / admin123');
    console.log('========================================');
    if (TEST_MODE) {
        console.log('🧪 TEST MODE: Payments are SIMULATED (no real money)');
        console.log('   ✅ M-Pesa payments work instantly for testing');
        console.log('   🔧 Set TEST_MODE = false for real M-Pesa');
    } else {
        console.log('💳 REAL M-PESA MODE: Real money transactions');
    }
    console.log('========================================\n');
});