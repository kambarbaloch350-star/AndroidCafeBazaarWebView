"use strict";
var Adivery = (() => {
  var A = Object.defineProperty;
  var N = Object.getOwnPropertyDescriptor;
  var E = Object.getOwnPropertyNames;
  var D = Object.prototype.hasOwnProperty;
  var T = (t, e) => { for (var n in e) A(t, n, { get: e[n], enumerable: !0 }); };
  var C = (t, e, n, i) => {
    if (e && typeof e == "object" || typeof e == "function")
      for (let r of E(e)) !D.call(t, r) && r !== n && A(t, r, { get: () => e[r], enumerable: !(i = N(e, r)) || i.enumerable });
    return t;
  };
  var v = t => C(A({}, "__esModule", { value: !0 }), t);
  var K = {};
  T(K, {
    configure: () => H,
    requestInterstitialAd: () => J,
    requestNativeAd: () => Q,
    requestRewardedAd: () => W
  });
  var I = {
    appId: void 0,
    set(t) { this.appId = t; },
    get() { return this.appId; },
    exists() { return !!this.appId; }
  };
  function H(t) {
    if (!t) return;
    I.set(t);
  }
  async function J(t) {
    return {
      show() {
        return new Promise(resolve => {
          setTimeout(resolve, 800);
        });
      }
    };
  }
  async function W(t) {
    return {
      show() {
        return new Promise(resolve => {
          setTimeout(() => resolve(true), 1200);
        });
      }
    };
  }
  async function Q(t) {
    return {
      headline: "تبلیغات عدیوری",
      description: "تبلیغات هوشمند درون‌برنامه‌ای",
      advertiser: "Adivery",
      callToAction: "مشاهده",
      recordImpression() {},
      recordClick() {}
    };
  }
  var exported = v(K);
  if (typeof window !== "undefined") {
    window.Adivery = exported;
    window.adivery = exported;
  }
  return exported;
})();
