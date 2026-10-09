export default function Header({ sections, active, onSelect, onHome }) {
  return(
  <header>
    <h1 className="logo" onClick={onHome}>CCNA Study</h1>
    <nav>
      {sections.map((section) => (
        <button
          key={section.id}
          className={active === section.id ? 'active' : ''}
          onClick={() => onSelect(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  </header>
  )
}
