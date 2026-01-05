const geoip = require("geoip-lite");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const BLOCKED_COUNTRIES = new Set([
    "CN", // China
    "RU", // Russia (optional)
    "IR", // Iran (optional)
    "KP", // North Korea (optional)
]);


function getClientIp(req) {
    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.length > 0) return cfIp.trim();

    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();

    return req.ip;
}

function normalizeIp(ip) {
    if (!ip) return "";
    if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length); // IPv4 mapped IPv6
    return ip;
}

function isPublicIp(ip) {
    if (!ip) return false;
    if (ip === "::1" || ip === "127.0.0.1") return false;
    if (ip.startsWith("10.")) return false;
    if (ip.startsWith("192.168.")) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return false;
    return true;
}

function lookupGeo(ip) {
    if (!isPublicIp(ip)) return null;
    return geoip.lookup(ip);
}

async function postToDiscord(content) {
    console.log("Trying to postToDiscord for " + content + " with link " + DISCORD_WEBHOOK_URL);

    if (!DISCORD_WEBHOOK_URL) return;

    await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({content}),
    });
}

function formatLocation(geo) {
    if (!geo) return "Unknown location";

    const city = geo.city;
    const region = geo.region;
    const country = geo.country;

    const parts = [city, region, country].filter(Boolean);
    return parts.length ? parts.join(", ") : "Unknown location";
}

function visitNotifierGeoipLite(options = {}) {
    const {
        paths = ["/"],
        cooldownMs = 60_000,
        ignoreUserAgents = [/bot/i, /spider/i, /crawl/i],
        includeIp = true,
        includeUa = true,
    } = options;

    const lastSeen = new Map(); // key: ip|path -> timestamp

    return async (req, res, next) => {
        try {
            if (!paths.includes(req.path)) return next();

            const ua = String(req.headers["user-agent"] || "");
            if (ignoreUserAgents.some(rx => rx.test(ua))) return next();

            const ip = normalizeIp(getClientIp(req));
            const key = `${ip}|${req.path}`;
            const now = Date.now();

            const prev = lastSeen.get(key);
            if (prev && now - prev < cooldownMs) return next();
            lastSeen.set(key, now);

            const geo = lookupGeo(ip);

            if (!geo) {
                return next();
            }

            if (BLOCKED_COUNTRIES.has(geo.country)) {
                console.log(`Blocked visit from ${geo.country} (${ip})`);
                return next();
            }

            console.log("geo: ", geo);
            const lines = [
                `🌐 **Portfolio opened**`,
                `• Path: \`${req.path}\``,
                `• From: **${formatLocation(geo)}**`,
            ];

            if (geo?.timezone) lines.push(`• TZ: \`${geo.timezone}\``);
            if (Array.isArray(geo?.ll) && geo.ll.length === 2) lines.push(`• Coords: \`${geo.ll[0]},${geo.ll[1]}\``);

            if (includeIp) lines.push(`• IP: \`${ip || "unknown"}\``);
            if (includeUa) lines.push(`• UA: \`${ua.slice(0, 180)}\``);

            await postToDiscord(lines.join("\n"));
        } catch {
            console.log("failed")
        }

        next();
    };
}

module.exports = {visitNotifierGeoipLite};
