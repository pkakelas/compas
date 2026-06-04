// chrome.jsx — shared app chrome (top bar)

function TopBar({ active = "Live", onNav, setTime = "1:42", clock = "23:11", level = 0.72, accent }) {
  const navs = ["Library", "Tandas", "Playlists", "Live", "Edit"];
  const routable = { Tandas: true, Playlists: true, Live: true };
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
            className={"tp-nav" + (n === active ? " is-active" : "") + (routable[n] ? " is-link" : "")}
            onClick={routable[n] && onNav ? () => onNav(n) : undefined}>
            {n}
          </div>
        ))}
      </div>
      <div className="tp-spacer"></div>

      <button className="tp-ai-pill"><span className="tp-ai-dot"></span> Assistant</button>

      <div className="tp-clock" title="time of night · set elapsed">
        <b>{clock}</b><span style={{ opacity: .5 }}>·</span> set {setTime}
      </div>

      <div className="tp-output" title="master output">
        <I.vol s={16} />
        <Meter level={level} />
      </div>
    </div>
  );
}

Object.assign(window, { TopBar });
