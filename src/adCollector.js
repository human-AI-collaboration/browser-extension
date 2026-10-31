// src/adCollector.js

let adsInfo = {
    adsLoaded: new Set(),
    adsSeen: new Set(),
    adLog: [],
};

const visibleAds = new Set();
const uniqueRedditAds = new Set();

let lastInfo = "";
let currentPostUUID = "";

const config = {
    callback: null,
    platform: null,
};

const host = window.location.hostname.toLowerCase();
if (host.endsWith("twitter.com") || host.endsWith("x.com")) {
    config.platform = "twitter";
} else if (host.endsWith("reddit.com") || host.endsWith("redd.it")) {
    config.platform = "reddit";
}

function getRedditAds() {
    const promotedPosts = document.querySelectorAll(
        'shreddit-sidebar-ad, shreddit-ad-post, shreddit-comments-page-ad, shreddit-dynamic-ad-link'
    );
    return promotedPosts;
}

function getRedditAdInfo(ad) {
    let company = '';

    const postId = ad.getAttribute('post-id') ?? "";
    const authorId = ad.getAttribute('author-id') ?? "";
    const author = ad.getAttribute('author') ?? "";
    const subreddit = ad.getAttribute('house-ad-href') ?? "";
    const domain = ad.getAttribute('domain') ?? "";

    if (subreddit || authorId || postId || author) {
        company = `${ad.tagName?.toLowerCase()}/${subreddit.replace('/r/', '')}/${authorId}/${postId}/${author}/${domain}`;
    }

    let uniqueId = ad.getAttribute('social-extension-unique-id');

    if (!uniqueId) {
        if (uniqueRedditAds.has(company)) {
            return "";
        } else {
            uniqueRedditAds.add(company);
            uniqueId = Math.floor(Math.random() * 1000000);
            ad.setAttribute('social-extension-unique-id', uniqueId);
        }
    }

    company += `--${uniqueId}`;

    return company;
}

function getTwitterAds() {
    return document.querySelectorAll('article > div > div > div > div > div > div > div > div > div > span');
}

function getTwitterAdInfo(ad) {
    let company = '';
    if (ad.innerText.trim() === 'Ad') {
        const adContainer = ad.closest('[data-testid="cellInnerDiv"]');
        if (adContainer) {
            const advertiserElement = adContainer.querySelector('[data-testid="User-Name"]');
            if (advertiserElement) {
                company = advertiserElement.innerText.trim().split('@')[1];
                if (!company) {
                    company = advertiserElement.innerText.trim();
                }
            }
        }
    }
    let uniqueId = ad.getAttribute('social-extension-unique-id');
    if (!uniqueId) {
        uniqueId = Math.floor(Math.random() * 1000000);
        ad.setAttribute('social-extension-unique-id', uniqueId);
    }
    return company + "--" + uniqueId;
}

export function resetPostAdData(postUUID) {
    if (currentPostUUID != postUUID) {
        currentPostUUID = postUUID;
        adsInfo = {
            adsLoaded: new Set(),
            adsSeen: new Set(),
            adLog: [],
        };
    }
}

export function getAdsInfo() {
    if (config.platform !== "twitter" && config.platform !== "reddit") {
        console.warn("Unsupported platform for ad collection:", config.platform);
        return null;
    }

    try {
        let ads = config.platform == "twitter" ? getTwitterAds() : getRedditAds();

        ads.forEach(ad => {
            let company = config.platform == "twitter" ? getTwitterAdInfo(ad) : getRedditAdInfo(ad);

            if (company) {
                const isVisible = isAdVisible(ad);
                adsInfo.adsLoaded.add(company);

                if (isVisible) {
                    adsInfo.adsSeen.add(company);
                    if (!visibleAds.has(company)) {
                        adsInfo.adLog.push({
                            ad: company,
                            becameVisible: Date.now(),
                        });
                    }
                    visibleAds.add(company);
                } else if (visibleAds.has(company)) {
                    adsInfo.adLog.push({
                        ad: company,
                        becameHidden: Date.now(),
                    });
                    visibleAds.delete(company);
                }
            }
        });
        return {
            adsLoaded: Array.from(adsInfo.adsLoaded),
            adsSeen: Array.from(adsInfo.adsSeen),
            adLog: adsInfo.adLog,
            stoppedCollecting: Date.now()
        };
    } catch (error) {
        console.error('Error in getAdsInfo:', error);
        return null;
    }
}

function isAdVisible(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}


export function collectAndSendData(forceCallback = false) {
    const adsInfoRet = getAdsInfo();

    const adsInfoString = JSON.stringify(adsInfo);
    if (config.callback && typeof config.callback === 'function') {
        if (adsInfoString !== lastInfo) {
            console.log("Ads Info:", adsInfo);
            lastInfo = adsInfoString;
            try {
                config.callback(adsInfoRet);
            } catch {}
        } else if (forceCallback) {
            try {
                config.callback(adsInfoRet);
            } catch {}
        }
    }

    return adsInfoRet;
}

export function initialCollectAndSendData(callback, platform) {
    config.callback = callback;
    config.platform = platform;
    collectAndSendData();
    window.addEventListener('scroll', () => collectAndSendData(false));
}

