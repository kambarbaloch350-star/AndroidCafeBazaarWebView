/**
 * app.js
 * Game logic for QuickGames (com.emochi.quickgames)
 * Powered by CafeBazaar In-App Billing and Adivery Mobile Ads.
 */
document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const coinBalanceEl = document.getElementById('coinBalance');
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    const currentLevelBadge = document.getElementById('currentLevelBadge');
    const levelProgressBar = document.getElementById('levelProgressBar');
    const luckyWheel = document.getElementById('luckyWheel');
    const btnSpinWheel = document.getElementById('btnSpinWheel');
    const btnCompleteLevel = document.getElementById('btnCompleteLevel');
    const toastContainer = document.getElementById('toastContainer');

    // State
    let coinBalance = parseInt(localStorage.getItem('user_coins') || '50', 10);
    let currentLevel = parseInt(localStorage.getItem('game_level') || '1', 10);
    let isSpinning = false;
    let wheelRotation = 0;

    // Wheel Prizes (8 Sectors)
    const WHEEL_SECTORS = [
        { label: '۵۰ سکه', coins: 50, color: '#f59e0b' },
        { label: '۱۰۰ سکه', coins: 100, color: '#6366f1' },
        { label: '۲۵۰ سکه', coins: 250, color: '#10b981' },
        { label: '۵۰۰ سکه', coins: 500, color: '#ec4899' },
        { label: '۱,۰۰۰ سکه', coins: 1000, color: '#3b82f6' },
        { label: 'جک‌پات ۲۵۰۰', coins: 2500, color: '#8b5cf6' },
        { label: '۷۵ سکه', coins: 75, color: '#14b8a6' },
        { label: '۳۰۰ سکه', coins: 300, color: '#f97316' }
    ];

    // SKU to Coins Map
    const SKU_COINS_MAP = {
        'coin_pack_250': 250,
        'coin_pack_750': 750,
        'coin_pack_2000': 2000,
        'coin_pack_5000': 5000,
        'coin_pack_10000': 10000,
        'coin_pack_25000': 25000
    };

    // Render Initial State
    updateCoinDisplay();
    updateLevelDisplay();
    renderWheelSlices();

    // Check bridge availability
    if (window.CafeBazaar && window.CafeBazaar.isAvailable()) {
        setStatus(true, 'متصل به کافه‌بازار و ادیوری');
    } else {
        setStatus(true, 'آماده بازی (محیط وب / نیتیو)');
    }

    // Bridge readiness events
    window.addEventListener('CafeBazaarBridgeReady', () => {
        setStatus(true, 'سرویس کافه‌بازار متصل شد');
    });

    window.addEventListener('AdiveryBridgeReady', () => {
        console.log('[QuickGames] Adivery Bridge Ready');
    });

    // =========================================================================
    // 1. Level Progression System (Shows Interstitial ad every 2 levels)
    // =========================================================================
    window.handleLevelUp = async function () {
        currentLevel++;
        coinBalance += 30; // 30 coins reward for clearing level
        localStorage.setItem('game_level', currentLevel.toString());
        localStorage.setItem('user_coins', coinBalance.toString());

        updateLevelDisplay();
        updateCoinDisplay();
        showToast(`مرحله ${currentLevel - 1} با موفقیت به پایان رسید! (+۳۰ سکه)`, 'success');

        // Every 2 levels: Show Adivery Interstitial Ad!
        if (currentLevel % 2 === 0) {
            showToast(`آماده‌سازی تبلیغ بین‌راهی ادیوری برای مرحله ${currentLevel}...`, 'info');
            try {
                if (window.Adivery && typeof window.Adivery.showInterstitial === 'function') {
                    await window.Adivery.showInterstitial();
                }
            } catch (err) {
                console.warn('[Adivery] Interstitial error:', err);
            }
        }
    };

    function updateLevelDisplay() {
        if (currentLevelBadge) {
            currentLevelBadge.textContent = `مرحله ${currentLevel}`;
        }
        if (levelProgressBar) {
            // Cycle progress bar every 2 levels
            const progress = (currentLevel % 2 === 0) ? 100 : 50;
            levelProgressBar.style.width = `${progress}%`;
        }
    }

    // =========================================================================
    // 2. Lucky Spinning Wheel (Powered by Adivery Rewarded Video)
    // =========================================================================
    function renderWheelSlices() {
        if (!luckyWheel) return;
        const total = WHEEL_SECTORS.length;
        const sliceAngle = 360 / total;

        // Render visual sector labels inside wheel
        WHEEL_SECTORS.forEach((sec, i) => {
            const el = document.createElement('div');
            el.className = 'wheel-sector-label';
            const rot = i * sliceAngle + (sliceAngle / 2);
            el.style.transform = `rotate(${rot}deg) translate(0, -95px)`;
            el.innerHTML = `<span>${sec.label}</span>`;
            luckyWheel.appendChild(el);
        });
    }

    window.handleSpinWheel = async function () {
        if (isSpinning) return;

        btnSpinWheel.disabled = true;
        btnSpinWheel.innerHTML = '<span class="spinner"></span> در حال تماشای تبلیغ ادیوری...';

        try {
            // Request Adivery Rewarded Video Ad
            let rewardResult = { rewardGranted: true };
            if (window.Adivery && typeof window.Adivery.showRewarded === 'function') {
                rewardResult = await window.Adivery.showRewarded();
            }

            if (rewardResult && rewardResult.rewardGranted) {
                // Ad completed! Spin the wheel
                isSpinning = true;
                btnSpinWheel.innerHTML = '🎡 گردونه در حال چرخش...';

                // Pick random winning sector
                const winningIndex = Math.floor(Math.random() * WHEEL_SECTORS.length);
                const prize = WHEEL_SECTORS[winningIndex];

                const sliceAngle = 360 / WHEEL_SECTORS.length;
                // Target angle so winning sector points to top
                const targetSectorAngle = 360 - (winningIndex * sliceAngle + (sliceAngle / 2));
                // Add 5 full rotations (1800 deg)
                wheelRotation += 1800 + (targetSectorAngle - (wheelRotation % 360));

                luckyWheel.style.transition = 'transform 3.5s cubic-bezier(0.15, 0.9, 0.25, 1)';
                luckyWheel.style.transform = `rotate(${wheelRotation}deg)`;

                setTimeout(() => {
                    isSpinning = false;
                    coinBalance += prize.coins;
                    localStorage.setItem('user_coins', coinBalance.toString());
                    updateCoinDisplay();

                    showToast(`🎉 تبریک! شما برنده ${prize.label} از گردونه شانس شدید!`, 'success');
                    btnSpinWheel.disabled = false;
                    btnSpinWheel.innerHTML = '<span class="btn-icon">🎬</span> چرخاندن مجدد با تماشای تبلیغ ادیوری';
                }, 3700);

            } else {
                showToast('برای دریافت شانس گردونه، باید ویدیوی تبلیغ را تا انتها مشاهده کنید.', 'error');
                btnSpinWheel.disabled = false;
                btnSpinWheel.innerHTML = '<span class="btn-icon">🎬</span> چرخاندن گردونه با تماشای تبلیغ ادیوری';
            }
        } catch (err) {
            console.error('[QuickGames] Wheel reward error:', err);
            showToast('خطا در دریافت تبلیغ ادیوری. لطفاً مجدداً امتحان کنید.', 'error');
            btnSpinWheel.disabled = false;
            btnSpinWheel.innerHTML = '<span class="btn-icon">🎬</span> چرخاندن گردونه با تماشای تبلیغ ادیوری';
        }
    };

    // =========================================================================
    // 3. CafeBazaar In-App Coin Store (All 6 SKUs with 4x Market Prices)
    // =========================================================================
    window.handlePurchase = async function (sku) {
        const coinAmount = SKU_COINS_MAP[sku] || 250;
        showToast(`در حال اتصال به درگاه پرداخت کافه‌بازار برای [${sku}]...`, 'info');

        try {
            const result = await window.CafeBazaar.purchase(sku, `order_${Date.now()}`);

            if (result && result.success) {
                // Grant coins immediately
                coinBalance += coinAmount;
                localStorage.setItem('user_coins', coinBalance.toString());
                updateCoinDisplay();

                showToast(`🎉 خرید بسته ${coinAmount} سکه با موفقیت انجام شد!`, 'success');

                // AUTOMATIC SILENT CONSUMPTION:
                // Consume token in background so product is immediately repurchasable without any manual user effort
                if (result.purchaseToken) {
                    window.CafeBazaar.consumePurchase(result.purchaseToken)
                        .then(() => console.log('[CafeBazaar] Token consumed automatically:', result.purchaseToken))
                        .catch(err => console.warn('[CafeBazaar] Auto-consume note:', err));
                }
            } else {
                showToast(`خرید لغو شد یا با خطا مواجه شد: ${result?.message || 'لغو توسط کاربر'}`, 'error');
            }
        } catch (err) {
            console.error('[CafeBazaar] Purchase error:', err);
            showToast(`خطا در فرآیند خرید: ${err.message || 'خطای شبکه یا لغو خرید'}`, 'error');
        }
    };

    // UI Helpers
    function updateCoinDisplay() {
        if (coinBalanceEl) {
            coinBalanceEl.textContent = coinBalance.toLocaleString('fa-IR');
        }
    }

    function setStatus(connected, text) {
        if (statusText) statusText.textContent = text;
        if (statusBadge) {
            if (connected) {
                statusBadge.classList.add('connected');
            } else {
                statusBadge.classList.remove('connected');
            }
        }
    }

    function showToast(message, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
});
