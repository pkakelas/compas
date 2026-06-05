// chrome.jsx — shared app chrome (top bar)

function TopBar({ active = "Live", onNav }) {
  const navs = ["Library", "Builder", "Tandas", "Playlists", "Live", "Settings"];
  return (
    <div className="tp-topbar">
      <div className="tp-brand">
        <div className="tp-brand-mark">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 17V7l7 5-7 5zM12 12l7-5v10z" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        <div className="tp-brand-name">Comp<span className="acc">á</span>s</div>
      </div>
      <div className="tp-navset">
        {navs.map((n) => (
          <div key={n}
            className={"tp-nav is-link" + (n === active ? " is-active" : "")}
            onClick={onNav ? () => onNav(n) : undefined}>
            {n}
          </div>
        ))}
      </div>
      <div className="tp-spacer"></div>
    </div>
  );
}

Object.assign(window, { TopBar });
