document.addEventListener('DOMContentLoaded', () => {
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    const coinBalanceEl = document.getElementById('coinBalance');
    const lastTokenEl = document.getElementById('lastToken');
    const logStreamEl = document.getElementById('logStream');
    const btnConsume = document.getElementById('btnConsume');

    let coinBalance = parseInt(localStorage.getItem('user_coins') || '50', 10);
    let lastPurchaseToken = localStorage.getItem('last_purchase_token') || '';

    updateCoinDisplay();
    updateTokenDisplay();
    addLog('Web application loaded. Initializing bridge...', 'info');

    window.addEventListener('CafeBazaarBridgeReady', () => {
        addLog('Native AndroidBridge signal received', 'success');
        if (CafeBazaar.isAvailable()) {
            statusText.textContent = 'Connected';
            statusBadge.className = 'status-badge connected';
        }
    });

    CafeBazaar.on('connection', (result) => {
        if (result.success) {
            statusText.textContent = 'Connected';
            statusBadge.className = 'status-badge connected';
            addLog('CafeBazaar billing connected: ' + result.message, 'success');
        } else {
            statusText.textContent = 'Disconnected';
            statusBadge.className = 'status-badge error';
            addLog('Connection error: ' + result.message, 'error');
        }
    });

    CafeBazaar.on('purchase', (result) => {
        if (result.success) {
            lastPurchaseToken = result.purchaseToken || '';
            localStorage.setItem('last_purchase_token', lastPurchaseToken);
            updateTokenDisplay();
            btnConsume.disabled = false;

            let coins = result.productId === 'coins_500' ? 500 : 100;
            coinBalance += coins;
            localStorage.setItem('user_coins', coinBalance.toString());
            updateCoinDisplay();
            addLog('Purchase SUCCESS: +' + coins + ' coins granted! (Token: ' + lastPurchaseToken.substring(0, 16) + '...)', 'success');
        } else {
            addLog('Purchase FAILED: ' + result.message, 'error');
        }
    });

    CafeBazaar.on('consume', (result) => {
        if (result.success) {
            addLog('Token CONSUMED successfully. Ready to repurchase.', 'success');
            lastPurchaseToken = '';
            localStorage.removeItem('last_purchase_token');
            updateTokenDisplay();
            btnConsume.disabled = true;
        } else {
            addLog('Consume FAILED: ' + result.message, 'error');
        }
    });

    window.handlePurchase = function(productId) {
        if (!CafeBazaar.isNativeBridgeAvailable()) {
            addLog('Running in web browser. Open in Android WebView to trigger native payment sheet.', 'warn');
            return;
        }
        CafeBazaar.purchase(productId, 'order_' + Date.now());
    };

    window.handleConsume = function() {
        if (!lastPurchaseToken) return;
        CafeBazaar.consumePurchase(lastPurchaseToken);
    };

    window.handleQueryPurchases = function() {
        CafeBazaar.getPurchases();
    };

    window.handleClearLogs = function() {
        logStreamEl.innerHTML = '';
    };

    function updateCoinDisplay() { coinBalanceEl.textContent = coinBalance.toLocaleString(); }
    function updateTokenDisplay() {
        if (lastPurchaseToken) {
            lastTokenEl.textContent = lastPurchaseToken.substring(0, 32) + '...';
            btnConsume.disabled = false;
        } else {
            lastTokenEl.textContent = 'None (no pending consumable token)';
            btnConsume.disabled = true;
        }
    }
    function addLog(msg, type = 'info') {
        const item = document.createElement('div');
        item.className = 'log-item ' + type;
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        item.textContent = '[' + time + '] ' + msg;
        logStreamEl.appendChild(item);
        logStreamEl.scrollTop = logStreamEl.scrollHeight;
    }
});
