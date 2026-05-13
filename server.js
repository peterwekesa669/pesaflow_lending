const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// In-memory storage
const users = [];
const loans = [];
let nextUserId = 1;
let nextLoanId = 1;

// ========== USER ROUTES ==========

// Register
app.post('/api/register', (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        const user = { id: nextUserId++, name, email, password, phone: phone || '' };
        users.push(user);
        res.json({ success: true, user: { id: user.id, name, email } });
        console.log('User registered:', email);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const user = users.find(u => u.email === email && u.password === password);
        if (user) {
            res.json({ success: true, user: { id: user.id, name: user.name, email } });
            console.log('User logged in:', email);
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check active loan
app.get('/api/check-active-loan/:userId', (req, res) => {
    const activeLoan = loans.find(l => l.userId == req.params.userId && l.status === 'active');
    res.json({ hasActiveLoan: !!activeLoan });
});

// Apply for loan
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
                message: `Loan approved! Pay KES ${totalPayable} by ${dueDate.toLocaleDateString()}`
            }
        });
        console.log('Loan applied:', amount);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get my loans
app.get('/api/loans/my/:userId', (req, res) => {
    try {
        const userLoans = loans.filter(l => l.userId == req.params.userId);
        res.json(userLoans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Dashboard stats
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

// Make payment
app.post('/api/payments', (req, res) => {
    try {
        const { loanId, amount } = req.body;
        const loan = loans.find(l => l.id == loanId);
        
        if (!loan) {
            return res.status(404).json({ error: 'Loan not found' });
        }
        
        if (amount > loan.remainingAmount) {
            return res.status(400).json({ error: 'Amount exceeds remaining balance' });
        }
        
        loan.paidAmount += amount;
        loan.remainingAmount -= amount;
        
        if (loan.remainingAmount <= 0) {
            loan.status = 'completed';
            loan.remainingAmount = 0;
        }
        
        let message = `Payment of KES ${amount} received. Remaining: KES ${loan.remainingAmount}`;
        if (loan.remainingAmount === 0) {
            message = 'Loan fully paid! Thank you!';
        }
        
        res.json({ success: true, message, remainingAmount: loan.remainingAmount });
        console.log('Payment made:', amount);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ADMIN ROUTES ==========

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    console.log('Admin login attempt:', email);
    if (email === 'admin@pesaflow.com' && password === 'admin123') {
        res.json({ success: true, admin: { name: 'Admin', role: 'admin' } });
        console.log('Admin login successful');
    } else {
        res.status(401).json({ error: 'Invalid admin credentials' });
        console.log('Admin login failed');
    }
});

// Get all users (admin)
app.get('/api/admin/users', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== 'Bearer admin123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const safeUsers = users.map(u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone }));
    res.json(safeUsers);
});

// Get all loans (admin)
app.get('/api/admin/loans', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== 'Bearer admin123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const allLoans = loans.map(loan => {
        const user = users.find(u => u.id == loan.userId);
        return {
            ...loan,
            borrowerName: user ? user.name : 'Unknown',
            borrowerEmail: user ? user.email : 'Unknown',
            dueDate: loan.dueDate.toLocaleDateString()
        };
    });
    res.json(allLoans);
});

// Get profit report (admin)
app.get('/api/admin/profits', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== 'Bearer admin123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const completedLoans = loans.filter(l => l.status === 'completed');
    const totalLoanAmount = completedLoans.reduce((sum, l) => sum + l.amount, 0);
    const totalCollected = completedLoans.reduce((sum, l) => sum + l.paidAmount, 0);
    const totalProfit = totalCollected - totalLoanAmount;
    const activeLoans = loans.filter(l => l.status === 'active');
    const expectedProfit = activeLoans.reduce((sum, l) => sum + (l.totalPayable - l.amount), 0);
    
    res.json({
        totalLoansGiven: loans.length,
        completedLoans: completedLoans.length,
        activeLoans: activeLoans.length,
        totalDisbursed: totalLoanAmount,
        totalCollected: totalCollected,
        totalProfit: totalProfit,
        expectedProfit: expectedProfit,
        averageInterestRate: 25
    });
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('PesaFlow Lending App is Running!');
    console.log(`Open: http://localhost:${PORT}`);
    console.log('Admin Login: admin@pesaflow.com / admin123');
    console.log('========================================\n');
});