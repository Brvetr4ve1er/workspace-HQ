// "New version inserted": a centred card, 1.2 s, once per build (logic/version-card.mjs decides; vals/version-card.js binds).
// <!-- v5: version card --> new fragment, placed as a sibling inside the root <div> (before the toast stack). It wraps itself in
// vcdv.vcdShow, so there is NO node in the page otherwise, and the keyframes below exist only while it shows. dc-lite dialect only: dotted
// paths. Tokens only (var(--...)); no literal colour. An original cartridge slides into a slot; the plate is the opaque --card-hi, so the
// caption (--text) and the stamp (--muted) sit on a solid surface whatever is behind the scrim, in both themes.
// No handlers here: any key or press is caught by the two layer listeners that exist only while this shows, and the overlay swallows the press
// so it never lands on a button underneath. role=status aria-live=polite; nothing takes focus; no sound.
// NO {{ }} may ever appear inside the <style> text: the runtime would turn it into a <span>.
const PLATE = 'display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 28px 18px;background:var(--card-hi);border:1px solid var(--frame-hi);border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.35);max-width:calc(100vw - 32px)';
const SLOT = 'fill:var(--ink);stroke:var(--frame-hi);stroke-width:1.5';

export default String.raw`  <!-- v5: version card — New version inserted (1.2 s, once per build, Console layer only) -->
  <sc-if value="{{ vcdv.vcdShow }}" hint-placeholder-val="{{ false }}">
    <div data-vcd="card" role="status" aria-live="polite" aria-label="{{ vcdv.vcdLabel }}" style="{{ vcdv.vcdCardStyle }}">
      <style>
        @keyframes hqvcd-card { 0% { opacity: 0; } 12% { opacity: 1; } 84% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes hqvcd-slide { 0% { transform: translateY(-46px); } 58% { transform: translateY(14px); } 100% { transform: translateY(14px); } }
      </style>
      <div data-vcd="plate" style="${PLATE}">
        <svg data-vcd="art" viewBox="0 0 160 110" width="160" height="110" role="img" aria-label="A game cartridge sliding into a console slot" style="display:block;overflow:hidden">
          <path d="{{ vcdv.vcdSlotMouth }}" style="${SLOT}"></path>
          <g data-vcd="cartridge" style="{{ vcdv.vcdCartStyle }}">
            <path d="{{ vcdv.vcdShell }}" style="fill:var(--card);stroke:var(--frame-hi);stroke-width:2;stroke-linejoin:round"></path>
            <path d="{{ vcdv.vcdLabelPath }}" style="fill:var(--bg);stroke:var(--gold);stroke-width:1.5"></path>
            <path d="{{ vcdv.vcdRidges }}" style="fill:none;stroke:var(--frame);stroke-width:1.5;stroke-linecap:round"></path>
            <path d="{{ vcdv.vcdContacts }}" style="fill:none;stroke:var(--gold);stroke-width:2;stroke-linejoin:round"></path>
          </g>
          <path d="{{ vcdv.vcdSlotPlate }}" style="fill:var(--card);stroke:var(--frame-hi);stroke-width:1.5;stroke-linejoin:round"></path>
        </svg>
        <div data-vcd="caption" style="font-size:15px;font-weight:600;color:var(--text);text-align:center">{{ vcdv.vcdCaption }}</div>
        <div data-vcd="stamp" style="font-family:var(--term);font-size:12px;color:var(--muted);text-align:center">{{ vcdv.vcdStamp }}</div>
      </div>
    </div>
  </sc-if>
`;
