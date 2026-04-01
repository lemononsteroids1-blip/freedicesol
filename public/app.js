let userBalance = 0;
let totalBets = 0;
let totalProfit = 0;

// Load user data on page load
window.onload = function() {
    loadUserData();
};

function loadUserData() {
    // Load from localStorage for demo
    userBalance = parseFloat(localStorage.getItem('userBalance')) || 100; // Start with $100
    totalBets = parseInt(localStorage.getItem('totalBets')) || 0;
    totalProfit = parseFloat(localStorage.getItem('totalProfit')) || 0;
    updateUI();
}

function saveUserData() {
    localStorage.setItem('userBalance', userBalance.toString());
    localStorage.setItem('totalBets', totalBets.toString());
    localStorage.setItem('totalProfit', totalProfit.toString());
}

function updateUI() {
    document.getElementById('balance').textContent = userBalance.toFixed(2);
    document.getElementById('total-bets').textContent = totalBets;
    document.getElementById('profit').textContent = totalProfit.toFixed(2);
    updateMultiplier();
}

function updateMultiplier() {
    const rollOver = parseInt(document.getElementById('roll-over').value);
    const multiplier = (99 / (99 - rollOver)).toFixed(2);
    document.getElementById('multiplier').textContent = multiplier + 'x';
}

document.getElementById('roll-over').addEventListener('input', updateMultiplier);

async function rollDice() {
    const betAmount = parseFloat(document.getElementById('bet-amount').value);
    const rollOver = parseInt(document.getElementById('roll-over').value);
    
    if (!betAmount || betAmount <= 0) {
        alert('Please enter a valid bet amount');
        return;
    }
    
    if (betAmount > userBalance) {
        alert('Insufficient balance');
        return;
    }
    
    if (rollOver < 2 || rollOver > 98) {
        alert('Roll over must be between 2 and 98');
        return;
    }
    
    const rollBtn = document.getElementById('roll-btn');
    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling...';
    
    // Generate dice result
    const diceResult = Math.floor(Math.random() * 100) + 1;
    const won = diceResult > rollOver;
    const multiplier = (99 / (99 - rollOver));
    const payout = won ? betAmount * multiplier : 0;
    
    // Update balance
    if (won) {
        userBalance += payout - betAmount; // Add profit
        totalProfit += payout - betAmount;
    } else {
        userBalance -= betAmount;
        totalProfit -= betAmount;
    }
    
    totalBets++;
    
    // Animate dice roll
    animateDiceRoll(diceResult, () => {
        document.getElementById('dice-result').textContent = diceResult;
        
        const resultText = document.getElementById('result-text');
        if (won) {
            resultText.textContent = `You won $${payout.toFixed(2)}!`;
            resultText.className = 'result-text win';
        } else {
            resultText.textContent = `You lost $${betAmount.toFixed(2)}`;
            resultText.className = 'result-text lose';
        }
        
        updateUI();
        saveUserData();
    });
    
    setTimeout(() => {
        rollBtn.disabled = false;
        rollBtn.textContent = 'Roll Dice';
    }, 2000);
}

function animateDiceRoll(finalResult, callback) {
    const diceElement = document.getElementById('dice-result');
    let count = 0;
    const maxCount = 20;
    
    const interval = setInterval(() => {
        diceElement.textContent = Math.floor(Math.random() * 100) + 1;
        count++;
        
        if (count >= maxCount) {
            clearInterval(interval);
            callback();
        }
    }, 100);
}

async function simulateDeposit() {
    try {
        const response = await fetch('/api/simulate-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            userBalance += data.amount;
            updateUI();
            saveUserData();
            alert(`Crypto deposit received: $${data.amount.toFixed(2)}!`);
        }
    } catch (error) {
        alert('Deposit error: ' + error.message);
    }
}