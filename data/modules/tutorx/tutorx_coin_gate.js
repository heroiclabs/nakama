// tutorx_coin_gate.js — per-service TutorX AI coin pricing (mirrors TutorX SPA catalog)

var TUTORX_SERVICE_CATALOG = {
    tutor_chat: { cost: 20, freeTier: true },
    essay_score: { cost: 25, freeTier: false },
    deep_solve: { cost: 30, freeTier: false },
    practice_gen: { cost: 25, freeTier: false },
    co_writer: { cost: 15, freeTier: true },
    deep_research: { cost: 45, freeTier: false },
    visualize: { cost: 30, freeTier: false },
    knowledge_search: { cost: 20, freeTier: true },
    memory_run: { cost: 25, freeTier: false },
    book_create: { cost: 35, freeTier: false },
    book_compile: { cost: 40, freeTier: false },
    book_deep_dive: { cost: 25, freeTier: false },
    score_predict: { cost: 20, freeTier: true },
    eval_grade: { cost: 25, freeTier: false },
    eval_scan: { cost: 20, freeTier: false },
    guided_lesson: { cost: 20, freeTier: true },
    guided_chat: { cost: 20, freeTier: true },
    guided_path: { cost: 30, freeTier: false },
    animation: { cost: 40, freeTier: false },
    study_plan: { cost: 30, freeTier: false },
    link_materials: { cost: 25, freeTier: false },
    battle_gen: { cost: 25, freeTier: false },
    quiz_gen: { cost: 25, freeTier: false }
};

var TUTORX_COIN_GATE_DEFAULTS = {
    FREE_MESSAGES_PER_DAY: 5,
    COST_PER_MESSAGE: 20,
    COLLECTION: "tutorx_daily_usage"
};

function tutorxTodayKey() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function tutorxUsageStorageKey(userId, today) {
    return "usage_" + userId + "_" + today;
}

function tutorxCurrencyKey(wallet) {
    if (wallet && wallet.currencies && typeof wallet.currencies.game === "number") {
        return "game";
    }
    return "tokens";
}

function tutorxCoinBalance(wallet) {
    if (!wallet || !wallet.currencies) {
        return 0;
    }
    var v = wallet.currencies[tutorxCurrencyKey(wallet)];
    return typeof v === "number" ? v : 0;
}

function tutorxResolveServiceCharge(data, baseConfig) {
    data = data || {};
    baseConfig = baseConfig || TUTORX_COIN_GATE_DEFAULTS;
    var service = data.service || "tutor_chat";
    var catalog = TUTORX_SERVICE_CATALOG[service];
    var fallbackCost = baseConfig.COST_PER_MESSAGE || TUTORX_COIN_GATE_DEFAULTS.COST_PER_MESSAGE;
    var cost = data.cost;
    if (cost === undefined || cost === null || isNaN(Number(cost))) {
        cost = catalog ? catalog.cost : fallbackCost;
    } else {
        cost = Math.max(0, parseInt(cost, 10) || 0);
    }
    var useFreeTier;
    if (data.useFreeTier === false) {
        useFreeTier = false;
    } else if (data.useFreeTier === true) {
        useFreeTier = true;
    } else {
        useFreeTier = catalog ? catalog.freeTier !== false : true;
    }
    return { service: service, cost: cost, useFreeTier: useFreeTier };
}

function tutorxNormalizeUsage(raw, today, freeLimit) {
    freeLimit = typeof freeLimit === "number" ? freeLimit : TUTORX_COIN_GATE_DEFAULTS.FREE_MESSAGES_PER_DAY;
    if (!raw || raw.date !== today) {
        return { date: today, usedToday: 0, freeUsedToday: 0, paidToday: 0 };
    }
    var freeUsed = typeof raw.freeUsedToday === "number" ? raw.freeUsedToday : (raw.usedToday || 0);
    if (freeUsed < 0) {
        freeUsed = 0;
    }
    if (freeUsed > freeLimit) {
        freeUsed = freeLimit;
    }
    var paidToday = typeof raw.paidToday === "number" ? raw.paidToday : Math.max(0, (raw.usedToday || 0) - freeUsed);
    var usedToday = typeof raw.usedToday === "number" ? raw.usedToday : (freeUsed + paidToday);
    return {
        date: today,
        usedToday: usedToday,
        freeUsedToday: freeUsed,
        paidToday: paidToday
    };
}

function tutorxFreeRemaining(usage, freeLimit) {
    var rem = freeLimit - (usage.freeUsedToday || 0);
    return rem < 0 ? 0 : rem;
}

function tutorxReadUsage(nk, collection, userId, today, freeLimit) {
    var usage = tutorxNormalizeUsage(null, today, freeLimit);
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: tutorxUsageStorageKey(userId, today),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            usage = tutorxNormalizeUsage(records[0].value, today, freeLimit);
        }
    } catch (err) {
        // caller logs
    }
    return usage;
}

function tutorxWriteUsage(nk, collection, userId, today, usage) {
    nk.storageWrite([{
        collection: collection,
        key: tutorxUsageStorageKey(userId, today),
        userId: userId,
        value: usage,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}
