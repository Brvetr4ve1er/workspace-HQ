// Placeholder Instagram (HTML) and Facebook (JSON) "Download your information" exports for tests and gates.
// Placeholder names and text only; ZIPs are written at runtime. The Facebook strings are written the way Meta writes
// them (UTF-8 bytes as \u00XX escapes) so the mojibake repair is exercised.
import { zipFiles } from './make-export.mjs';

export const OWNER = 'Placeholder Owner';
const meta = (s) => Buffer.from(s, 'utf8').toString('latin1');   // Meta's encoding of a UTF-8 string
const T = 1759320000;   // 2025-10-01T12:00:00Z (seconds)

export function facebookFiles() {
  const json = (o) => JSON.stringify(o);
  return [
    { name: 'personal_information/profile_information/profile_information.json', data: json({ profile_v2: {
      name: { full_name: meta(OWNER), first_name: 'Placeholder', last_name: 'Owner' },
      emails: { emails: ['owner@example.invalid'] }, birthday: { year: 2000, month: 1, day: 2 },
      current_city: { name: meta('Placeholder City é'), timestamp: T }, intro_bio: 'placeholder bio',
      family_members: [{ name: 'Placeholder Relative', relation: 'Sibling' }] } }) },
    { name: 'connections/friends/your_friends.json', data: json({ friends_v2: [{ name: 'Placeholder Friend', timestamp: T }] }) },
    { name: 'your_facebook_activity/messages/inbox/friendone_100/message_1.json', data: json({
      participants: [{ name: 'Placeholder Friend' }, { name: meta(OWNER) }], title: 'Placeholder Friend', thread_path: 'inbox/friendone_100',
      messages: [
        { sender_name: 'Placeholder Friend', timestamp_ms: (T + 60) * 1000, content: meta('مرحبا placeholder lantern') },
        { sender_name: meta(OWNER), timestamp_ms: (T + 30) * 1000, content: 'placeholder hello from me', photos: [{ uri: 'your_facebook_activity/messages/photos/1.jpg' }] },
      ] }) },
    { name: 'your_facebook_activity/messages/inbox/friendone_100/message_2.json', data: json({
      participants: [], title: 'Placeholder Friend', messages: [{ sender_name: meta(OWNER), timestamp_ms: T * 1000, content: 'placeholder first message' }] }) },
    { name: 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json', data: json([
      { timestamp: T, title: meta(OWNER) + ' updated status.', data: [{ post: meta('Placeholder lantern post café') }], attachments: [{ data: [{ media: { uri: 'your_facebook_activity/posts/media/x.jpg' } }] }] },
    ]) },
    { name: 'your_facebook_activity/comments_and_reactions/likes_and_reactions_1.json', data: json([
      { timestamp: T, title: 'liked a post', data: [{ reaction: { reaction: 'LIKE', actor: meta(OWNER) } }] }]) },
    { name: 'ads_information/ad_preferences.json', data: json({ label_values: [{ label: 'Interest', value: 'Placeholder lanterns' }, { label: 'Device ID', value: 'abc-123' }, { label: 'Connection type', value: 'Wi-Fi' }] }) },
    { name: 'security_and_login_information/account_activity.json', data: json({ account_activity_v2: [{ action: 'Login', ip_address: '192.0.2.1' }] }) },
    { name: 'your_facebook_activity/facebook_payments/payment_history.json', data: json({ payments: [{ amount: '1' }] }) },
    { name: 'your_facebook_activity/posts/media/your_posts/x.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
  ];
}

const block = (inner) => `<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">${inner}</div>`;
const row2 = (k, v) => `<tr><td class="_2pin _a6_q">${k}</td><td class="_2pin _2piu _a6_r">${v}</td></tr>`;
const rowSpan = (k, v) => `<tr><td colspan="2" class="_2pin _a6_q">${k}<div><div>${v}</div></div></td></tr>`;
const page = (title, body) => `<!DOCTYPE html><html><head><title>${title}</title><style>._a6-g{x:1}</style></head><body><main class="_a706" role="main">${body}</main></body></html>`;
const msg = (who, text, when, extra = '') => block(`<h2 class="_3-95 _2pim _a6-h _a6-i">${who}</h2><div class="_3-95 _a6-p"><div><div></div><div>${text}</div><div>${extra}</div><div></div></div></div><div class="_3-94 _a6-o">${when}</div>`);

export function instagramFiles() {
  return [
    { name: 'start_here.html', data: page('Start', '') },
    { name: 'personal_information/personal_information/instagram_profile_information.html', data: page('Profile info', block('<table>' + row2('First Close Friends Story Time', 'Oct 01, 2025 12:00 pm') + '</table>')) },
    { name: 'personal_information/personal_information/personal_information.html', data: page('Personal information', block('<h2 class="_a6-h">User Information</h2><div class="_a6-p"><table>'
      + rowSpan('Email', 'owner@example.invalid') + rowSpan('Phone Number', '+000') + rowSpan('Username', 'placeholder.owner') + rowSpan('Name', OWNER)
      + rowSpan('Bio', 'placeholder designer &amp; maker') + rowSpan('Date of birth', '2000-01-02') + '</table></div>')) },
    { name: 'your_instagram_activity/messages/inbox/friendtwo_200/message_1.html', data: page('Placeholder Pal',
      block('<h2 class="_a6-h">Participants: Placeholder Pal and ' + OWNER + '</h2>')
      + msg('Placeholder Pal', 'placeholder lantern reply &#064;soon', 'Oct 02, 2025 6:26 pm')
      + msg(OWNER, '', 'Oct 02, 2025 6:20 pm', '<a href="https://www.instagram.com/reel/PLACEHOLDER/">reel</a><img src="photos/1.jpg" />')
      + msg(OWNER, 'placeholder question', 'Oct 2, 2025 12:05 am')) },
    { name: 'your_instagram_activity/likes/liked_posts.html', data: page('Liked posts', block('<div class="_3-95 _a6-p">'
      + block('<div class="_a6-p"><table>' + rowSpan('URL', '<a href="https://www.instagram.com/p/AAA/">x</a>') + row2('Caption', 'placeholder lantern caption')
        + '<tr><td colspan="2" class="_a6_q">Owner<div>' + block('<div class="_a6-p"><table>' + row2('Username', 'acct.one') + row2('Name', 'Account One') + '</table></div>') + '</div></td></tr>'
        + row2('Time', 'Oct 03, 2025 9:00 am') + '</table></div>')
      + block('<div class="_a6-p"><table>' + row2('Caption', 'placeholder second') + '<tr><td colspan="2" class="_a6_q">Owner<div>' + block('<div class="_a6-p"><table>' + row2('Username', 'acct.one') + '</table></div>') + '</div></td></tr></table></div>')
      + '</div>')) },
    { name: 'your_instagram_activity/media/posts_1.html', data: page('Posts', block('<div class="_3-95 _a6-p"><table>' + rowSpan('Caption', 'placeholder my own post')
      + rowSpan('Latitude', '36.7') + rowSpan('Longitude', '3.0') + rowSpan('Device ID', 'android-abc') + rowSpan('File size in bytes', '1024') + '</table></div><div class="_3-94 _a6-o">Sep 30, 2025 8:00 pm</div>')) },
    { name: 'security_and_login_information/login_and_profile_creation/login_activity.html', data: page('Logins', block('<table>' + row2('IP Address', '192.0.2.1') + '</table>')) },
    { name: 'connections/contacts/synced_contacts.html', data: page('Contacts', block('<table>' + row2('Name', 'Someone Private') + '</table>')) },
    { name: 'media/posts/202510/x.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
  ];
}

export const writeFacebookZip = (file, extra = []) => zipFiles(file, [...facebookFiles(), ...extra]);
export const writeInstagramZip = (file, extra = []) => zipFiles(file, [...instagramFiles(), ...extra]);
