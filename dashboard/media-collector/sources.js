'use strict';
// Capability registry — the UI reads this; adapters declare what they really
// do. States: supported | limited | authorization-required | unavailable.
// Nothing here is a promise: `limited` adapters say exactly what is bounded.
const SOURCES = {
  direct: {
    id: 'direct', label: 'Direct media link', state: 'supported', auth: 'none',
    urlTypes: ['A link that ends in a media file (jpg, png, gif, webp, mp4, webm, mp3, …)'],
    mediaTypes: ['image', 'video', 'audio'], pagination: 'none', rateLimits: 'Polite: 2 connections per host',
    limitations: ['The file type is decided from the response bytes, not the link.', 'Stream manifests (m3u8, mpd) and HTML pages are refused, not saved.'],
    nextAction: 'Paste the link and save.',
    docs: [],
  },
  webpage: {
    id: 'webpage', label: 'Public web page', state: 'limited', auth: 'none',
    urlTypes: ['Any public http(s) page'],
    mediaTypes: ['image', 'video', 'audio'], pagination: 'none (one page per scan)', rateLimits: 'One page fetch, bounded candidate probing',
    limitations: ['Scans one page only; nothing is crawled.', 'Only what the HTML exposes: img/video/audio elements, srcset, Open Graph and Twitter cards, JSON-LD, and plainly linked media files.', 'Scripts are never executed, so media that only loads with JavaScript or a login is not visible.', 'Bounded page size, candidate count, and scan time; partial results are marked.', 'robots.txt rules for this page are respected when enabled in Settings.'],
    nextAction: 'Paste a page link, review the candidates, pick what to save.',
    docs: [],
  },
  tumblr: {
    id: 'tumblr', label: 'Tumblr', state: 'authorization-required', auth: 'Tumblr API key (OAuth 1.0a consumer key) for public blog content; OAuth 2.0 user authorization for dashboard content',
    urlTypes: ['Blog posts', 'Blog URLs'],
    mediaTypes: ['image', 'video', 'audio'], pagination: 'Official API offset/before cursors', rateLimits: 'Per Tumblr API documentation (per-key limits)',
    limitations: ['Not implemented in this version. The official API is the only path this app will use; logged-in page scraping is out of scope by design.', 'Requires registering an application at the Tumblr developer portal and storing the key in the OS credential vault.'],
    nextAction: 'A direct media link from a Tumblr post (64.media.tumblr.com/…) works today through the direct resolver.',
    docs: [{ label: 'Tumblr API documentation', url: 'https://www.tumblr.com/docs/en/api/v2' }, { label: 'Register an application', url: 'https://www.tumblr.com/oauth/apps' }],
  },
  reddit: {
    id: 'reddit', label: 'Reddit', state: 'authorization-required', auth: 'Reddit Data API with OAuth 2.0; commercial or large-scale use needs Reddit approval',
    urlTypes: ['Posts', 'Subreddit and user listings'],
    mediaTypes: ['image', 'video (as exposed by the API)'], pagination: 'Official listing cursors (after/before)', rateLimits: 'Per Reddit Data API terms (per OAuth client)',
    limitations: ['Not implemented in this version. Requires an OAuth client registered with Reddit and compliance with the Data API Terms (rate limits, content retention, deletion handling).', 'User content belongs to its creator; the app will save only what the API exposes and only on explicit selection.'],
    nextAction: 'A direct media link (i.redd.it/…) works today through the direct resolver.',
    docs: [{ label: 'Reddit Data API wiki', url: 'https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki' }, { label: 'Reddit API documentation', url: 'https://www.reddit.com/dev/api/' }, { label: 'Reddit Developer Terms', url: 'https://redditinc.com/policies/developer-terms' }],
  },
  instagram: {
    id: 'instagram', label: 'Instagram', state: 'unavailable', auth: 'Official Instagram Platform APIs only (user consent, app review); no logged-in scraping',
    urlTypes: ['Posts', 'Profiles', 'Reels'],
    mediaTypes: [], pagination: 'n/a', rateLimits: 'n/a',
    limitations: ['Instagram post and profile URLs cannot be resolved by this app. The official APIs expose media only for accounts that have granted consent to a reviewed app, and this app has no such integration.', 'No scraping, no session or cookie import, no private-account access — by design.'],
    nextAction: 'Use Instagram’s own "Download your information" export for your account, or paste a direct media link you are entitled to save.',
    docs: [{ label: 'Instagram Platform documentation', url: 'https://developers.facebook.com/docs/instagram-platform/' }, { label: 'Download your information (Instagram Help)', url: 'https://help.instagram.com/181231772500920' }],
  },
  facebook: {
    id: 'facebook', label: 'Facebook', state: 'unavailable', auth: 'Official Graph API only (user consent, app review); no logged-in scraping',
    urlTypes: ['Posts', 'Pages', 'Videos'],
    mediaTypes: [], pagination: 'n/a', rateLimits: 'n/a',
    limitations: ['Facebook URLs cannot be resolved by this app. Graph API access to media requires a reviewed app and the content owner’s consent; this app has no such integration.', 'No scraping, no session or cookie import — by design.'],
    nextAction: 'Use Facebook’s "Download your information" export for your own account, or paste a direct media link you are entitled to save.',
    docs: [{ label: 'Graph API documentation', url: 'https://developers.facebook.com/docs/graph-api/' }, { label: 'Download your information (Facebook Help)', url: 'https://www.facebook.com/help/212802592074644' }],
  },
  youtube: { id: 'youtube', label: 'YouTube', state: 'unsupported', auth: 'n/a', urlTypes: ['Videos', 'Shorts', 'Channels'], mediaTypes: [], pagination: 'n/a', rateLimits: 'n/a',
    limitations: ['Video streams are not exposed as plain files; extracting them would mean working around the platform’s delivery and terms, which this app does not do.'],
    nextAction: 'Open the video in your browser. Open Graph thumbnails on the watch page are visible through the page scan.', docs: [] },
  x: { id: 'x', label: 'X (Twitter)', state: 'unsupported', auth: 'n/a', urlTypes: ['Posts', 'Profiles'], mediaTypes: [], pagination: 'n/a', rateLimits: 'n/a',
    limitations: ['Post pages render through scripts and a login wall; the official API is paid and not integrated.'],
    nextAction: 'Paste a direct media link (pbs.twimg.com/…) you are entitled to save.', docs: [] },
  tiktok: { id: 'tiktok', label: 'TikTok', state: 'unsupported', auth: 'n/a', urlTypes: ['Videos', 'Profiles'], mediaTypes: [], pagination: 'n/a', rateLimits: 'n/a',
    limitations: ['Video delivery is script-driven and signed; the official APIs do not expose downloads to third-party apps.'],
    nextAction: 'Use TikTok’s own "Download your data" export for your account.', docs: [] },
};

const STATE_LABEL = { supported: 'Supported', limited: 'Supported with limits', 'authorization-required': 'Authorization required', unavailable: 'Unavailable', unsupported: 'Unsupported' };

function capability(id) { return SOURCES[id] || SOURCES.webpage; }
function list() { return Object.values(SOURCES); }

module.exports = { SOURCES, STATE_LABEL, capability, list };
