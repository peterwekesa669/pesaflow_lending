const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ========== SETTINGS ==========
// SET THIS TO false FOR REAL M-PESA TESTING
// SET THIS TO true FOR SIMULATION (no actual API call)
const TEST_MODE = false;  // ← false = real M-Pesa API, true = simulation

// In-memory storage
const users = [];
const loans = [];
let nextUserId = 1;
let nextLoanId = 1;

// ========== M-PESA CONFIGURATION ==========
const MPESA_CONFIG = {
    consumerKey: 'XumLmTm2fOQ2Lf9KG5ibb6QYE4CmzxjMuvHOIGfGCiWnZHA',
    consumerSecret: 'j9T3TiANLj0HAosJtqYrhwpoMfleiv5Hd64SirF8mQSMZall7T863kVX7Wg05N',
    passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
    shortcode: '174379',
    environment: 'sandbox'
};

// Get OAuth token from Safaricom
async function getMpesaToken() {
    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');
    try {
        console.log('🔄 Getting M-Pesa token...');
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        console.log('✅ Token obtained successfully');
        return response.data.access_token;
    } catch (error) {
        console.error('❌ M-Pesa token error:', error.response?.data || error.message);
        return null;
    }
}

// Format phone number for M-Pesa (254XXXXXXXXX)
function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    } else if (!cleaned.startsWith('254')) {
        cleaned = '254' + cleaned;
    }
    console.log('📱 Formatted phone:', cleaned);
    return cleaned;
}

// ========== M-PESA STK PUSH ROUTE ==========
app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
        const { phone, amount, loanId, userId } = req.body;
        
        console.log('========================================');
        console.log('💰 M-PESA PAYMENT REQUEST RECEIVED');
        console.log('   Phone:', phone);
        console.log('   Amount:', amount);
        console.log('   Loan ID:', loanId);
        console.log('   User ID:', userId);
        console.log('========================================');
        
        // Find the loan
        const loan = loans.find(l => l.id == loanId && l.userId == userId);
        if (!loan) {
            console.log('❌ Loan not found:', loanId);
            return res.status(404).json({ error: 'Loan not found' });
        }
        
        if (amount > loan.remainingAmount) {
            console.log('❌ Amount exceeds remaining balance');
            return res.status(400).json({ error: `Amount exceeds remaining balance of KES ${loan.remainingAmount}` });
        }
        
        if (TEST_MODE) {
            // ========== TEST MODE - Simulate successful payment ==========
            console.log('🧪 TEST MODE: Simulating payment of KES', amount);
            
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
            console.log('✅ TEST MODE: Payment recorded');
            
        } else {
            // ========== REAL M-PESA MODE ==========
            const formattedPhone = formatPhoneNumber(phone);
            const token = await getMpesaToken();
            
            if (!token) {
                console.log('❌ Failed to get M-Pesa token');
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
            
            console.log('📤 Sending STK push request to Safaricom...');
            const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', data, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            console.log('📥 STK push response:', response.data);
            
            loan.mpesaCheckoutID = response.data.CheckoutRequestID;
            loan.pendingPaymentAmount = amount;
            
            res.json({ 
                success: true, 
                message: '📱 M-Pesa prompt sent to your phone. Enter your PIN to complete payment.',
                checkoutRequestID: response.data.CheckoutRequestID
            });
            console.log('✅ STK push sent successfully');
        }
        
    } catch (error) {
        console.error('❌ M-Pesa error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Payment failed. Please try again.' });
    }
});

// ========== M-PESA CALLBACK ROUTE ==========
app.post('/api/mpesa/callback', (req, res) => {
    const { Body } = req.body;
    console.log('========================================');
    console.log('📞 M-PESA CALLBACK RECEIVED');
    console.log(JSON.stringify(Body, null, 2));
    console.log('========================================');
    
    if (Body?.stkCallback?.ResultCode === 0) {
        const checkoutRequestID = Body.stkCallback.CheckoutRequestID;
        const callbackMetadata = Body.stkCallback.CallbackMetadata?.Item || [];
        
        let amount = 0;
        let receiptNumber = '';
        
        callbackMetadata.forEach(item => {
            if (item.Name === 'Amount') amount = item.Value;
            if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
        });
        
        const loan = loans.find(l => l.mpesaCheckoutID === checkoutRequestID);
        
        if (loan) {
            const paymentAmount = loan.pendingPaymentAmount || amount;
            
            loan.paidAmount = (loan.paidAmount || 0) + paymentAmount;
            loan.remainingAmount -= paymentAmount;
            
            if (loan.remainingAmount <= 0) {
                loan.status = 'completed';
                loan.remainingAmount = 0;
            }
            
            loan.mpesaReceipt = receiptNumber;
            loan.mpesaPaidAt = new Date();
            delete loan.mpesaCheckoutID;
            delete loan.pendingPaymentAmount;
            
            console.log(`✅ Payment recorded: KES ${paymentAmount} for loan ${loan.id}`);
            console.log(`   Receipt: ${receiptNumber}`);
            console.log(`   Remaining: KES ${loan.remainingAmount}`);
        } else {
            console.log(`❌ Loan not found for CheckoutID: ${checkoutRequestID}`);
        }
    } else {
        console.log(`❌ M-Pesa payment failed: ${Body?.stkCallback?.ResultDesc || 'Unknown error'}`);
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
        console.log('🧪 TEST MODE: Payments are SIMULATED');
    } else {
        console.log('💳 REAL M-PESA MODE: Sandbox API');
        console.log('   Test Phone: 254708374149');
        console.log('   Test PIN: 123456');
    }
    console.log('========================================\n');
});