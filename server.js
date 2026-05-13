const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const users = [];
const loans = [];
let nextUserId = 1;
let nextLoanId = 1;

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
                message: `Loan approved! Pay KES ${totalPayable} by ${dueDate.toLocaleDateString()}`
            }
        });
        console.log('Loan applied:', amount);
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('PesaFlow Lending App is Running!');
    console.log('Open: http://localhost:3000');
    console.log('========================================\n');
});