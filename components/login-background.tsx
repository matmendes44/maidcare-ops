// Decorative scene behind the sign-in card: a cleaner pushing a vacuum across
// the floor, leaving a clean shine behind, while soap bubbles drift up.
// Pure CSS animation (see .login-scene in globals.css); it holds still for
// people who prefer reduced motion.

const bubbles = [
  { left: "6%", size: 22, duration: 15, delay: 0 },
  { left: "18%", size: 12, duration: 11, delay: 4 },
  { left: "31%", size: 30, duration: 18, delay: 8 },
  { left: "47%", size: 14, duration: 13, delay: 2 },
  { left: "62%", size: 26, duration: 17, delay: 6 },
  { left: "74%", size: 10, duration: 10, delay: 1 },
  { left: "86%", size: 34, duration: 20, delay: 9 },
  { left: "94%", size: 16, duration: 14, delay: 5 },
];

export function LoginBackground() {
  return (
    <div aria-hidden="true" className="login-scene pointer-events-none absolute inset-0 overflow-hidden">
      <div className="login-glow" />
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="login-bubble"
          style={{ left: b.left, width: b.size, height: b.size, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s` }}
        />
      ))}
      <div className="login-floor" />
      <div className="login-shine" />
      <div className="login-walker">
        <svg viewBox="0 0 150 120" width="130" height="104">
          {/* legs swing from the hip */}
          <g className="login-leg-back">
            <line x1="44" y1="74" x2="44" y2="104" stroke="#1F2A44" strokeWidth="7" strokeLinecap="round" />
            <ellipse cx="47" cy="107" rx="7" ry="3.5" fill="#1F2A44" />
          </g>
          <g className="login-leg-front">
            <line x1="46" y1="74" x2="46" y2="104" stroke="#2B3A5E" strokeWidth="7" strokeLinecap="round" />
            <ellipse cx="49" cy="107" rx="7" ry="3.5" fill="#2B3A5E" />
          </g>
          <g className="login-body">
            {/* torso, apron and pocket */}
            <rect x="31" y="34" width="28" height="44" rx="9" fill="#3174E7" />
            <rect x="35" y="48" width="20" height="26" rx="4" fill="#FFFFFF" opacity="0.92" />
            <rect x="40" y="60" width="10" height="7" rx="2" fill="#63AE33" />
            {/* arm reaching to the vacuum handle */}
            <line x1="52" y1="44" x2="84" y2="52" stroke="#E8B48A" strokeWidth="6" strokeLinecap="round" />
            {/* head, hair and a green headband */}
            <circle cx="45" cy="21" r="11" fill="#E8B48A" />
            <path d="M34 20 a11 11 0 0 1 22 0 q-3 -4 -11 -4 t-11 4z" fill="#3B2A20" />
            <rect x="34" y="15" width="22" height="4" rx="2" fill="#63AE33" />
            <circle cx="50" cy="22" r="1.4" fill="#3B2A20" />
          </g>
          {/* upright vacuum */}
          <g className="login-vacuum">
            <line x1="84" y1="50" x2="110" y2="100" stroke="#3A4254" strokeWidth="3.5" strokeLinecap="round" />
            <rect x="86" y="58" width="13" height="30" rx="6" fill="#63AE33" transform="rotate(-27 92 73)" />
            <rect x="100" y="98" width="38" height="10" rx="4" fill="#3A4254" />
            <rect x="104" y="101" width="30" height="2.5" rx="1" fill="#63AE33" />
            <circle cx="105" cy="109" r="3.5" fill="#1F2A44" />
          </g>
          {/* sparkles puffing up behind the vacuum head */}
          <g fill="#3174E7">
            <path className="login-sparkle login-sparkle-1" d="M92 96 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z" />
            <path className="login-sparkle login-sparkle-2" d="M80 100 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" fill="#63AE33" />
            <path className="login-sparkle login-sparkle-3" d="M70 94 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1z" />
          </g>
        </svg>
      </div>
    </div>
  );
}
