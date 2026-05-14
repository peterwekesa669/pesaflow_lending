const express = require('express');
const app = express();
app.use(express.json());

console.log('========================================');
console.log('M-PESA TEST SERVER RUNNING');
console.log('This simulates M-Pesa payments');
console.log('========================================\n');

// Test STK Push endpoint (simulates M-Pesa)
app.post('/mpesa/stkpush', (req, res) => {
    console.log('📱 Payment request received:');
    console.log('   Phone:', req.body.phone);
    console.log('   Amount: KES', req.body.amount);
    console.log('   Loan ID:', req.body.loanId);
    
    // Simulate successful payment
    res.json({
        success: true,
        message: '✅ Payment successful! (TEST MODE)',
        checkoutRequestID: 'TEST-' + Date.now()
    });
});

// Test Callback endpoint
app.post('/mpesa/callback', (req, res) => {
    console.log('📞 Callback received:', req.body);
    res.json({ ResultCode: 0, ResultDesc: "Success" });
});

app.listen(4000, () => {
    console.log('Test M-Pesa Server running on port 4000');
    console.log('Use this for testing before going live!\n');
});