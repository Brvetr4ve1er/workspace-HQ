// SOCIAL READ SWITCH — the popup half (extension 0.9.0). A classic popup script loaded by one <script> tag in popup.html,
// after popup.js. It fills the placeholder #social-auto with a checkbox and the plain words about what the periodic read
// does. It reads the setting from chrome.storage.local ('hq_social_read') and changes it only through the service
// worker's 'social:set' message (the worker owns the alarm). Text nodes only. It makes no network call.
// Null-safe: no #social-auto, no chrome, or any failure and the popup is left exactly as it was.

/* global chrome, document */

const socialSwPopupTitle = 'social';
const socialSwPopupLabel = 'read every 5 minutes';
const socialSwPopupNote = 'Read my logged-in social tabs every 5 minutes. When on, the extension reads the feed, mentions and account numbers visible in tabs you already have open and logged in, and sends them to this app. Nothing in the app uses what it reads today. Off by default. Posting stays behind Approve & send either way.';
const socialSwPopupOnText = 'On — reading your open, logged-in social tabs every 5 minutes.';
const socialSwPopupOffText = 'Off — nothing is read from your social tabs on a timer.';
const socialSwPopupFailText = "Couldn't change this — try again.";

function socialSwPopupFind(doc, id) {
  try { return doc.getElementById(id) || null; } catch { return null; }   // a missing id is null in a browser, a throw in a strict fake
}

// Builds the section into the placeholder and wires it. Returns the controls (null when there is nothing to build into).
function socialSwPopupInit(doc, api) {
  try {
    const host = socialSwPopupFind(doc, 'social-auto');
    if (!host || !api || !api.storage || !api.storage.local || !api.runtime) return null;
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    const head = mk('div', 'appr-head');
    head.appendChild(mk('span', 'k', socialSwPopupTitle));
    head.appendChild(mk('span', 'grow'));
    const label = mk('label', 'mini');
    const box = mk('input');
    box.type = 'checkbox'; box.id = 'social-read-on'; box.checked = false;
    label.appendChild(box);
    label.appendChild(mk('span', '', ' ' + socialSwPopupLabel));
    head.appendChild(label);
    const status = mk('div', 'm', socialSwPopupOffText);
    status.id = 'social-read-status'; status.role = 'status';
    const note = mk('div', 'note', socialSwPopupNote);
    host.appendChild(head); host.appendChild(status); host.appendChild(note);

    const show = (on) => { box.checked = on === true; status.textContent = on === true ? socialSwPopupOnText : socialSwPopupOffText; };
    // the state on open comes from storage; anything but { on: true } reads as off
    Promise.resolve(api.storage.local.get('hq_social_read')).then((o) => { const v = o && o.hq_social_read; show(!!v && v.on === true); }).catch(() => show(false));

    box.addEventListener('change', () => {
      const want = box.checked === true;
      box.disabled = true;
      Promise.resolve(api.runtime.sendMessage({ type: 'social:set', on: want })).then((r) => {
        if (r && typeof r.on === 'boolean') show(r.on);
        else { show(!want); status.textContent = socialSwPopupFailText; }   // no usable answer: put the box back and say so
      }).catch(() => { show(!want); status.textContent = socialSwPopupFailText; }).then(() => { box.disabled = false; });
    });
    return { host, box, status, note, show };
  } catch { return null; }
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') socialSwPopupInit(document, chrome);
