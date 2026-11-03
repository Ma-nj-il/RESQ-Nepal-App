import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowNarrowRight,
  BarChartSquare02,
  Bell01,
  Building07,
  Eye,
  Grid01,
  Lock01,
  LogOut01,
  Plus,
  Route,
  SearchMd,
  Settings01,
  User01,
  Users01,
  Wallet01,
} from '@untitled-ui/icons-react';
import './styles.css';

const navItems = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Rides', icon: 'route' },
  { label: 'Drivers', icon: 'users', badge: '12' },
  { label: 'Riders', icon: 'user' },
  { label: 'Hospitals', icon: 'hospital' },
  { label: 'Analytics', icon: 'chart' },
];

const stats = [
  { label: 'Total rides today', value: '248', change: '+12.5%', tone: 'red', icon: 'route' },
  { label: 'Active rides', value: '36', change: '+8.2%', tone: 'blue', icon: 'pulse' },
  { label: 'Online drivers', value: '84', change: '+4.6%', tone: 'green', icon: 'users' },
  { label: 'Today’s revenue', value: 'NPR 184,560', change: '+18.4%', tone: 'purple', icon: 'wallet' },
];

const approvals = [
  { initials: 'SK', name: 'Suman Karki', vehicle: 'Toyota HiAce · BA 2 KHA 3384', time: '2h ago', color: 'orange' },
  { initials: 'RM', name: 'Rita Maharjan', vehicle: 'Mahindra Bolero · BA 3 CHA 9012', time: '5h ago', color: 'purple' },
  { initials: 'AS', name: 'Anil Shrestha', vehicle: 'Toyota HiAce · BA 1 JHA 5578', time: 'Yesterday', color: 'teal' },
];

const rides = [
  { id: '#RSQ-10482', rider: 'Nabin Thapa', route: 'Patan Hospital → Norvic Hospital', driver: 'Bikash Lama', fare: 'NPR 1,250', status: 'In progress', statusTone: 'progress', time: '10:42 AM' },
  { id: '#RSQ-10481', rider: 'Mina Gurung', route: 'Boudha → Grande Hospital', driver: 'Suresh Rai', fare: 'NPR 980', status: 'Completed', statusTone: 'completed', time: '10:35 AM' },
  { id: '#RSQ-10480', rider: 'Prakash KC', route: 'Baneshwor → Bir Hospital', driver: '—', fare: '—', status: 'Searching', statusTone: 'searching', time: '10:31 AM' },
  { id: '#RSQ-10479', rider: 'Aasha Shahi', route: 'Kalimati → Teaching Hospital', driver: 'Deepak Tamang', fare: 'NPR 1,840', status: 'Completed', statusTone: 'completed', time: '10:14 AM' },
];

const drivers = [
  { initials: 'SK', name: 'Suman Karki', phone: '+977 9801234567', vehicle: 'Toyota HiAce', plate: 'BA 2 KHA 3384', status: 'Pending approval', tone: 'pending', rating: '4.8' },
  { initials: 'RM', name: 'Rita Maharjan', phone: '+977 9812345678', vehicle: 'Mahindra Bolero', plate: 'BA 3 CHA 9012', status: 'Pending approval', tone: 'pending', rating: '4.9' },
  { initials: 'BL', name: 'Bikash Lama', phone: '+977 9823456789', vehicle: 'Toyota HiAce', plate: 'BA 1 JHA 5578', status: 'Online', tone: 'online', rating: '4.7' },
  { initials: 'ST', name: 'Suresh Tamang', phone: '+977 9845678901', vehicle: 'Force Traveller', plate: 'BA 4 PA 2210', status: 'Offline', tone: 'offline', rating: '4.6' },
];

function Icon({ name, size = 17 }) {
  const icons = {
    grid: Grid01,
    route: Route,
    users: Users01,
    user: User01,
    hospital: Building07,
    chart: BarChartSquare02,
    pulse: Activity,
    wallet: Wallet01,
    bell: Bell01,
    settings: Settings01,
    search: SearchMd,
    plus: Plus,
    arrow: ArrowNarrowRight,
    lock: Lock01,
    eye: Eye,
    logout: LogOut01,
  };
  const IconComponent = icons[name];
  return <IconComponent className="icon" width={size} height={size} aria-hidden="true" />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  function submit(event) {
    event.preventDefault();
    if (!email || !password) {
      setError('Enter your admin email and password to continue.');
      return;
    }
    onLogin();
  }

  return <main className="login-shell">
    <section className="login-visual">
      <div className="login-brand"><span className="brand-mark">+</span><span><b>RESQ</b><small>Nepal Admin</small></span></div>
      <div className="login-visual-copy"><span className="overline">OPERATIONS COMMAND CENTER</span><h1>Every response<br /><em>starts here.</em></h1><p>Coordinate emergency transport, support drivers, and keep every ride moving safely across Nepal.</p></div>
      <div className="login-visual-footer"><span>Trusted emergency mobility infrastructure</span><span>Since 2026</span></div>
    </section>
    <section className="login-form-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-login-brand"><span className="brand-mark">+</span><b>RESQ</b></div>
        <span className="overline">WELCOME BACK</span><h2>Sign in to your workspace</h2><p className="muted">Use your administrator credentials to access the dashboard.</p>
        <label>Email address<input type="email" placeholder="admin@resqnepal.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>Password<div className="password-input"><input type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password visibility"><Icon name="eye" size={16} /></button></div></label>
        <div className="login-options"><label className="check-label"><input type="checkbox" /> Remember me</label><button type="button" className="link-button">Forgot password?</button></div>
        {error && <p className="form-error">{error}</p>}
        <button className="login-button" type="submit">Sign in <Icon name="arrow" size={16} /></button>
        <p className="login-security"><Icon name="lock" size={14} /> Protected by RESQ secure access</p>
      </form>
    </section>
  </main>;
}

function Overview({ selectNav }) {
  const [range, setRange] = useState('This month');
  return <div className="overview-page"><div className="page-heading"><div><p className="eyebrow">Tuesday, November 3, 2026</p><h1>Good morning, Admin</h1><p className="muted">Here’s what’s happening with RESQ Nepal today.</p></div><button className="primary-button"><Icon name="plus" size={15} /> Create report</button></div>
    <section className="stat-grid">{stats.map((stat) => <article className="stat-card" key={stat.label}><div className={`stat-icon ${stat.tone}`}><Icon name={stat.icon} size={19} /></div><div className="stat-copy"><span>{stat.label}</span><strong>{stat.value}</strong><small><b>↑ {stat.change}</b> <em>vs yesterday</em></small></div><button className="more-button" aria-label="More options">•••</button></article>)}</section>
    <section className="dashboard-grid"><article className="panel revenue-panel"><div className="panel-heading"><div><h2>Revenue overview</h2><p className="muted">Your revenue performance over time</p></div><select value={range} onChange={(event) => setRange(event.target.value)}><option>This month</option><option>Last month</option><option>This year</option></select></div><div className="revenue-total"><strong>NPR 2,486,420</strong><span>↑ 18.4%</span></div><div className="chart"><div className="chart-y"><span>250k</span><span>200k</span><span>150k</span><span>100k</span><span>50k</span><span>0</span></div><div className="chart-area"><div className="chart-gridlines">{[1, 2, 3, 4, 5].map((line) => <i key={line} />)}</div><svg viewBox="0 0 600 220" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e53935" stopOpacity=".22" /><stop offset="100%" stopColor="#e53935" stopOpacity="0" /></linearGradient></defs><path d="M0 176 C45 163 47 153 91 159 S137 118 182 128 S220 90 273 105 S320 68 364 82 S420 43 455 62 S505 35 545 52 S574 19 600 25 L600 220 L0 220 Z" fill="url(#area)" /><path d="M0 176 C45 163 47 153 91 159 S137 118 182 128 S220 90 273 105 S320 68 364 82 S420 43 455 62 S505 35 545 52 S574 19 600 25" fill="none" stroke="#e53935" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><div className="chart-x">{['01', '03', '05', '07', '09', '11', '13', '15', '17', '19', '21', '23'].map((day) => <span key={day}>{day}</span>)}</div></div></div></article><article className="panel live-panel"><div className="panel-heading"><div><h2>Live operations</h2><p className="muted">Real-time fleet activity</p></div><span className="live-dot"><i /> Live</span></div><div className="live-map"><div className="map-grid" /><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" /><div className="map-pin pin-one">+</div><div className="map-pin pin-two">+</div><div className="map-pin pin-three">+</div><span className="map-label label-one">Thamel</span><span className="map-label label-two">Baneshwor</span><span className="map-label label-three">Patan</span></div><div className="live-stats"><div><span className="legend green" />Available <strong>84</strong></div><div><span className="legend orange" />On trip <strong>36</strong></div><div><span className="legend gray" />Offline <strong>128</strong></div></div></article></section>
    <section className="content-grid"><article className="panel approvals-panel"><div className="panel-heading"><div><h2>Pending driver approvals</h2><p className="muted">Review and verify new drivers</p></div><button className="text-button" onClick={() => selectNav('Drivers')}>View all <Icon name="arrow" size={13} /></button></div><div className="approval-list">{approvals.map((approval) => <div className="approval-row" key={approval.name}><div className={`avatar avatar-${approval.color}`}>{approval.initials}</div><div className="approval-copy"><strong>{approval.name}</strong><span>{approval.vehicle}</span></div><time>{approval.time}</time><button className="review-button" onClick={() => selectNav('Drivers')}>Review</button></div>)}</div><div className="approval-footer"><span><b>12</b> drivers waiting for approval</span><button className="text-button" onClick={() => selectNav('Drivers')}>Manage approvals <Icon name="arrow" size={13} /></button></div></article><article className="panel alert-panel"><div className="panel-heading"><div><h2>Action required</h2><p className="muted">Items that need your attention</p></div><span className="alert-count">5</span></div><div className="alert-list"><button><span className="alert-icon alert-red">!</span><span><strong>3 fraud alerts</strong><small>Requires investigation</small></span><b>›</b></button><button><span className="alert-icon alert-yellow">▣</span><span><strong>2 expired documents</strong><small>Driver documents need renewal</small></span><b>›</b></button><button><span className="alert-icon alert-blue">☷</span><span><strong>8 negative reviews</strong><small>Below 3-star rating</small></span><b>›</b></button></div><button className="outline-button" onClick={() => selectNav('Analytics')}>View all alerts</button></article></section>
    <RidesPanel selectNav={selectNav} />;
  </div>;
}

function RidesPanel({ selectNav }) {
  return <article className="panel rides-panel"><div className="panel-heading"><div><h2>Recent rides</h2><p className="muted">Latest activity across the network</p></div><button className="text-button" onClick={() => selectNav('Rides')}>View all rides <Icon name="arrow" size={13} /></button></div><div className="table-wrap"><table><thead><tr><th>Ride ID</th><th>Rider</th><th>Route</th><th>Driver</th><th>Fare</th><th>Status</th><th>Time</th></tr></thead><tbody>{rides.map((ride) => <tr key={ride.id}><td><strong className="ride-id">{ride.id}</strong></td><td>{ride.rider}</td><td className="route-cell">{ride.route}</td><td>{ride.driver}</td><td><strong>{ride.fare}</strong></td><td><span className={`status-pill ${ride.statusTone}`}><i />{ride.status}</span></td><td className="time-cell">{ride.time}</td></tr>)}</tbody></table></div></article>;
}

function SectionPage({ active }) {
  const [query, setQuery] = useState('');
  const isDrivers = active === 'Drivers';
  const isRides = active === 'Rides';
  const rows = isDrivers ? drivers : rides;
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <div className="section-page"><div className="section-heading"><div><p className="eyebrow">Workspace / {active}</p><h1>{active}</h1><p className="muted">{isDrivers ? 'Manage verification, availability, and fleet records.' : isRides ? 'Monitor every emergency ride across the network.' : `Manage ${active.toLowerCase()} and keep operations organized.`}</p></div><button className="primary-button"><Icon name="plus" size={15} /> Add {active === 'Drivers' ? 'driver' : active === 'Hospitals' ? 'hospital' : 'record'}</button></div><div className="section-toolbar"><div className="search-field"><Icon name="search" size={16} /><input placeholder={`Search ${active.toLowerCase()}...`} value={query} onChange={(event) => setQuery(event.target.value)} /></div><select><option>All status</option><option>Active</option><option>Pending</option></select><button className="filter-button">Filters</button></div><div className="panel data-panel"><div className="table-wrap"><table><thead>{isDrivers ? <tr><th>Driver</th><th>Contact</th><th>Vehicle</th><th>Rating</th><th>Status</th><th>Action</th></tr> : <tr><th>Ride ID</th><th>Rider</th><th>Route</th><th>Driver</th><th>Fare</th><th>Status</th><th>Time</th></tr>}</thead><tbody>{filtered.map((row) => isDrivers ? <tr key={row.name}><td><div className="person-cell"><div className="avatar avatar-red">{row.initials}</div><strong>{row.name}</strong></div></td><td>{row.phone}</td><td>{row.vehicle}<small className="cell-sub">{row.plate}</small></td><td>{row.rating} <span className="rating-star">★</span></td><td><span className={`status-pill ${row.tone}`}><i />{row.status}</span></td><td><button className="row-action">View details</button></td></tr> : <tr key={row.id}><td><strong className="ride-id">{row.id}</strong></td><td>{row.rider}</td><td className="route-cell">{row.route}</td><td>{row.driver}</td><td><strong>{row.fare}</strong></td><td><span className={`status-pill ${row.statusTone}`}><i />{row.status}</span></td><td className="time-cell">{row.time}</td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-state">No records match your search.</div>}</div></div>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [active, setActive] = useState('Overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  function selectNav(label) { setActive(label); setSidebarOpen(false); }
  return <div className="app-shell">{sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}<aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="brand"><div className="brand-mark">+</div><div><strong>RESQ</strong><span>Nepal Admin</span></div><button className="close-sidebar" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">×</button></div><div className="workspace-label">WORKSPACE</div><nav>{navItems.map((item) => <button key={item.label} className={`nav-item ${active === item.label ? 'nav-active' : ''}`} onClick={() => selectNav(item.label)}><span className="nav-icon"><Icon name={item.icon} size={17} /></span><span>{item.label}</span>{item.badge && <span className="nav-badge">{item.badge}</span>}</button>)}</nav><div className="sidebar-bottom"><button className={`nav-item ${active === 'Settings' ? 'nav-active' : ''}`} onClick={() => selectNav('Settings')}><span className="nav-icon"><Icon name="settings" size={17} /></span><span>Settings</span></button><button className="admin-profile" onClick={() => setAuthenticated(false)}><div className="avatar avatar-red">AR</div><div><strong>Admin account</strong><span>Sign out</span></div><Icon name="logout" size={15} /></button></div></aside><main className="main-content"><header className="topbar"><button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{active}</strong></div><div className="topbar-actions"><button className="icon-button notification" aria-label="Notifications"><Icon name="bell" size={19} /><i /></button><div className="topbar-divider" /><div className="topbar-user"><div className="avatar avatar-red">AR</div><span>Admin</span><span className="chevron">⌄</span></div></div></header><div className="page">{active === 'Overview' ? <Overview selectNav={selectNav} /> : <SectionPage active={active} />}<footer className="footer">RESQ Nepal Admin · Operations dashboard <span>System status: <b><i /> All systems operational</b></span></footer></div></main></div>;
}

createRoot(document.getElementById('root')).render(<App />);
