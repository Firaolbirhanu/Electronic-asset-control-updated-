import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const NAV = {
  officer: [['verify', 'Verify'], ['employees', 'Employees'], ['devices', 'Devices'], ['logs', 'Activity']],
  admin: [['officers', 'Security officers'], ['employees', 'Employees'], ['devices', 'Devices'], ['logs', 'Activity']],
};
const DEVICE_STATUSES = ['active', 'lost', 'stolen', 'decommissioned'];
const DEVICE_TYPES = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Camera', 'Printer', 'Other'];

async function api(path, { method = 'GET', body } = {}) {
  const options = { method };
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body || {});
  }
  const response = await fetch('/api' + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function Tag({ value, children }) {
  return <span className={`tag ${value}`}>{children || value}</span>;
}

function Table({ headings, children }) {
  return <div className="tablewrap"><table><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function Login({ onLogin }) {
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await onLogin({ username: form.get('username'), password: form.get('password') });
    } catch (loginError) {
      setError(loginError.message);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-story">
        <div className="login-brand"><span className="brand-mark">AC</span><div><strong>Asset Control</strong><span>Inventory management</span></div></div>
        <div>
          <p className="eyebrow" style={{ color: '#a9d8d0' }}>CONTROL YOUR INVENTORY</p>
          <h1>Every asset.<br />Accounted for.</h1>
          <p>A single, secure workspace to manage equipment, ownership and verification across your organization.</p>
          <div className="login-features"><span>Centralized asset records</span><span>Fast QR verification</span><span>Auditable activity history</span></div>
        </div>
        <div className="login-note">SECURE OPERATIONS&nbsp; · &nbsp;ASSET MANAGEMENT</div>
      </section>
      <section className="login-side">
        <form className="login" onSubmit={submit}>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to your workspace</h2>
          <p className="login-intro">Enter your account details to continue.</p>
          <label>Username<input name="username" autoComplete="username" required autoFocus /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="banner bad" style={{ marginTop: '1rem' }}>{error}</p>}
          <button className="primary">Sign in</button>
        </form>
      </section>
    </div>
  );
}

function AppShell({ user, page, onNavigate, onChangePassword, onSignOut, children }) {
  const items = NAV[user.role];
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Asset Control home" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark">AC</span>
          <span className="brand-copy"><strong>Asset Control</strong><span>Inventory management</span></span>
        </a>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main navigation">
          {items.map(([key, label], index) => (
            <button key={key} aria-current={page === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
              <span className="nav-icon">{String(index + 1).padStart(2, '0')}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><strong>Secure asset operations</strong>Track, verify and manage your organization’s equipment.</div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <span className="eyebrow">ASSET OPERATIONS&nbsp; / &nbsp;WORKSPACE</span>
          <div className="top-actions">
            <span className="who"><span className="avatar">{initials}</span>{user.name} · {user.role}</span>
            <button className="quiet" onClick={onChangePassword}>Change password</button>
            <button className="quiet" onClick={onSignOut}>Sign out</button>
          </div>
        </header>
        <main id="main" key={page}>{children}</main>
      </section>
    </div>
  );
}

function Scanner({ onScan, onError }) {
  const scannerId = 'qr-reader';
  useEffect(() => {
    if (!window.Html5Qrcode) {
      onError('Camera unavailable. Allow camera access, or type the ID instead.');
      return undefined;
    }

    const scanner = new window.Html5Qrcode(scannerId);
    let stopped = false;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 240 },
      (text) => {
        if (stopped) return;
        stopped = true;
        onScan(text);
      },
    ).catch(() => {
      if (!stopped) onError('Camera unavailable. Allow camera access, or type the ID instead.');
    });

    return () => {
      stopped = true;
      scanner.stop().catch(() => {}).finally(() => {
        try { scanner.clear(); } catch (_) { /* Scanner may not have started. */ }
      });
    };
  }, [onError, onScan]);

  return <div id={scannerId} />;
}

function DeviceDetails({ device }) {
  return (
    <dl>
      <dt>Asset ID</dt><dd>{device.asset_id}</dd><dt>Type</dt><dd>{device.type}</dd>
      <dt>Brand and model</dt><dd>{[device.brand, device.model].filter(Boolean).join(' ') || 'Not recorded'}</dd>
      <dt>Serial number</dt><dd>{device.serial_number}</dd><dt>Status</dt><dd><Tag value={device.status} /></dd>
    </dl>
  );
}

function OwnerDetails({ device }) {
  return (
    <dl>
      <dt>Name</dt><dd>{device.owner_name}</dd><dt>Employee ID</dt><dd>{device.owner_code}</dd>
      <dt>Department</dt><dd>{device.owner_department || 'Not recorded'}</dd><dt>Phone</dt><dd>{device.owner_phone || 'Not recorded'}</dd>
    </dl>
  );
}

function VerifyView({ notify, onUnauthorized }) {
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('manual');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const lookup = useCallback(async (value, lookupMethod = 'manual') => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setCode(trimmed);
    setMethod(lookupMethod);
    setError('');
    try {
      setResult(await api('/verify/' + encodeURIComponent(trimmed)));
    } catch (lookupError) {
      if (lookupError.status === 401) return onUnauthorized();
      setResult(null);
      setError(lookupError.message);
    }
  }, [onUnauthorized]);

  const scannerError = useCallback((message) => {
    setScannerOpen(false);
    notify(message);
  }, [notify]);

  const scanned = useCallback((text) => {
    setScannerOpen(false);
    lookup(text, 'qr');
  }, [lookup]);

  async function record(resultValue) {
    try {
      await api('/verify/' + encodeURIComponent(result.device.asset_id), {
        method: 'POST',
        body: { result: resultValue, method, note },
      });
      setResult({ kind: 'recorded', result: resultValue, assetId: result.device.asset_id });
      setCode('');
    } catch (recordError) {
      if (recordError.status === 401) return onUnauthorized();
      notify(recordError.message);
    }
  }

  return (
    <>
      <h2>Verify ownership</h2>
      <div className="panel">
        <form className="row" onSubmit={(event) => { event.preventDefault(); setScannerOpen(false); lookup(code); }}>
          <label className="grow">Asset ID or employee ID
            <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" placeholder="For example AST-000012" required />
          </label>
          <button className="primary">Look up</button>
          <button type="button" onClick={() => setScannerOpen((open) => !open)}>{scannerOpen ? 'Stop scanning' : 'Scan QR code'}</button>
        </form>
        {scannerOpen && <div id="reader"><Scanner onScan={scanned} onError={scannerError} /></div>}
      </div>
      {error && <div className="banner bad">{error}</div>}
      {result?.kind === 'employee' && (
        <div className="panel">
          <h3>{result.employee.full_name} ({result.employee.employee_id})</h3>
          <p>{result.employee.department || ''} {result.employee.phone || ''}</p>
          <p>Scan or enter a device's asset ID to verify a specific device.</p>
          {result.devices.length ? (
            <Table headings={['Asset ID', 'Device', 'Serial', 'Status']}>
              {result.devices.map((device) => <tr key={device.id}><td>{device.asset_id}</td><td>{device.type} {device.brand || ''} {device.model || ''}</td><td>{device.serial_number}</td><td><Tag value={device.status} /></td></tr>)}
            </Table>
          ) : <p>No devices registered to this employee.</p>}
        </div>
      )}
      {result?.kind === 'device' && (
        <>
          <div className={`banner ${result.device.status === 'active' ? 'ok' : 'bad'}`}>
            {result.device.status === 'active' ? 'Registered device. Compare the owner below with the person in front of you.' : `This device is marked ${result.device.status}. Do not clear it.`}
          </div>
          <div className="panel grid2"><section><h3>Device</h3><DeviceDetails device={result.device} /></section><section><h3>Registered owner</h3><OwnerDetails device={result.device} /></section></div>
          <div className="panel">
            <label>Note (optional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength="500" /></label>
            <div className="row" style={{ marginTop: '.75rem' }}>
              <button className="ok" onClick={() => record('verified')}>Owner matches</button>
              <button className="bad" onClick={() => record('mismatch')}>Owner does not match</button>
            </div>
          </div>
        </>
      )}
      {result?.kind === 'recorded' && (
        <div className={`banner ${result.result === 'verified' ? 'ok' : 'bad'}`}>
          Recorded as {result.result === 'verified' ? 'verified' : 'mismatch'} for {result.assetId}.
        </div>
      )}
    </>
  );
}

function SearchBox({ value, onChange }) {
  return <div className="panel"><label>Search<input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Name, ID or department" /></label></div>;
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function EmployeesView({ user, notify, onUnauthorized }) {
  const canEdit = user.role === 'officer';
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query);
  const [rows, setRows] = useState([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    api('/employees?q=' + encodeURIComponent(search)).then((data) => {
      if (active) setRows(data);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    });
    return () => { active = false; };
  }, [search, refresh, notify, onUnauthorized]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/employees', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      notify('Employee registered.');
      setRefresh((value) => value + 1);
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  return (
    <>
      <h2>Employees</h2>
      {canEdit && <form className="panel row" onSubmit={submit}>
        <label className="grow">Employee ID<input name="employee_id" required /></label>
        <label className="grow">Full name<input name="full_name" required /></label>
        <label className="grow">Department<input name="department" /></label>
        <label className="grow">Phone<input name="phone" type="tel" /></label>
        <button className="primary">Register employee</button>
      </form>}
      <SearchBox value={query} onChange={setQuery} />
      {rows.length ? (
        <Table headings={['Employee ID', 'Name', 'Department', 'Phone']}>
          {rows.map((row) => <tr key={row.id}><td>{row.employee_id}</td><td>{row.full_name}</td><td>{row.department}</td><td>{row.phone}</td></tr>)}
        </Table>
      ) : <p>No employees found. Register the first one above.</p>}
    </>
  );
}

function DevicesView({ user, notify, onUnauthorized, onShowLabel }) {
  const canEdit = user.role === 'officer';
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query);
  const [rows, setRows] = useState([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!canEdit) return undefined;
    let active = true;
    api('/employees').then((data) => {
      if (active) setEmployees(data);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    });
    return () => { active = false; };
  }, [canEdit, notify, onUnauthorized]);

  useEffect(() => {
    let active = true;
    api('/devices?q=' + encodeURIComponent(search)).then((data) => {
      if (active) setRows(data);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    });
    return () => { active = false; };
  }, [search, refresh, notify, onUnauthorized]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await api('/devices', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      notify('Device registered as ' + data.asset_id + '.');
      setRefresh((value) => value + 1);
      onShowLabel(data.id);
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  async function changeStatus(id, status) {
    try {
      await api('/devices/' + id, { method: 'PATCH', body: { status } });
      notify('Status updated.');
      setRows((current) => current.map((row) => row.id === id ? { ...row, status } : row));
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else {
        notify(error.message);
        setRefresh((value) => value + 1);
      }
    }
  }

  return (
    <>
      <h2>Devices</h2>
      {canEdit && <form className="panel row" onSubmit={submit}>
        <label className="grow">Owner<select name="employee_id" required defaultValue=""><option value="">Choose an employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} ({employee.employee_id})</option>)}</select></label>
        <label className="grow">Type<select name="type" required>{DEVICE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="grow">Brand<input name="brand" /></label>
        <label className="grow">Model<input name="model" /></label>
        <label className="grow">Serial number<input name="serial_number" required /></label>
        <button className="primary">Register device</button>
      </form>}
      <SearchBox value={query} onChange={setQuery} />
      {rows.length ? (
        <Table headings={['Asset ID', 'Device', 'Serial', 'Owner', 'Status', '']}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.asset_id}</td><td>{row.type} {row.brand || ''} {row.model || ''}</td><td>{row.serial_number}</td>
              <td>{row.owner_name}<br /><small>{row.owner_code}</small></td>
              <td>{canEdit
                ? <select value={row.status} aria-label={`Status for ${row.asset_id}`} onChange={(event) => changeStatus(row.id, event.target.value)}>{DEVICE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
                : <Tag value={row.status} />}</td>
              <td><button className="small" onClick={() => onShowLabel(row.id)}>QR label</button></td>
            </tr>
          ))}
        </Table>
      ) : <p>No devices found. Register the first one above.</p>}
    </>
  );
}

function OfficersView({ notify, onUnauthorized }) {
  const [rows, setRows] = useState([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    api('/officers').then((data) => {
      if (active) setRows(data);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    });
    return () => { active = false; };
  }, [refresh, notify, onUnauthorized]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/officers', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      notify('Officer created.');
      setRefresh((value) => value + 1);
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  async function toggle(officer) {
    try {
      await api('/officers/' + officer.id, { method: 'PATCH', body: { active: !officer.active } });
      setRefresh((value) => value + 1);
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  async function resetPassword(id) {
    const password = prompt('Enter a new temporary password (8+ characters):');
    if (!password) return;
    try {
      await api('/officers/' + id + '/password', { method: 'POST', body: { password } });
      notify('Password reset.');
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  return (
    <>
      <h2>Security officers</h2>
      <form className="panel row" onSubmit={submit}>
        <label className="grow">Full name<input name="name" required /></label>
        <label className="grow">Username<input name="username" autoCapitalize="none" required /></label>
        <label className="grow">Temporary password (8+ characters)<input name="password" type="password" minLength="8" autoComplete="new-password" required /></label>
        <button className="primary">Create officer</button>
      </form>
      {rows.length ? (
        <Table headings={['Name', 'Username', 'Status', '']}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td><td>{row.username}</td>
              <td>{row.active ? <Tag value="active" /> : <Tag value="decommissioned">disabled</Tag>}</td>
              <td><button className="small" onClick={() => toggle(row)}>{row.active ? 'Disable' : 'Enable'}</button>{' '}
                <button className="small" onClick={() => resetPassword(row.id)}>Reset password</button></td>
            </tr>
          ))}
        </Table>
      ) : <p>No security officers yet. Create the first one above.</p>}
    </>
  );
}

function ActivityView({ notify, onUnauthorized }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let active = true;
    api('/logs').then((data) => {
      if (active) setRows(data);
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    });
    return () => { active = false; };
  }, [notify, onUnauthorized]);

  return (
    <>
      <h2>Verification activity</h2>
      {rows.length ? (
        <Table headings={['Time', 'Asset ID', 'Owner', 'Result', 'Method', 'Officer', 'Note']}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</td><td>{row.asset_id}</td>
              <td>{row.owner_name}</td><td><Tag value={row.result} /></td>
              <td>{row.method === 'qr' ? 'QR scan' : 'Typed ID'}</td><td>{row.officer_name}</td><td>{row.note}</td>
            </tr>
          ))}
        </Table>
      ) : <p>No verifications recorded yet.</p>}
    </>
  );
}

function Modal({ open, onClose, children, className = '' }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return <dialog ref={dialog} className={className} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>{children}</dialog>;
}

function PasswordDialog({ open, onClose, notify, onUnauthorized }) {
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/me/password', { method: 'POST', body: { current: form.get('current'), next: form.get('next') } });
      onClose();
      notify('Password changed.');
    } catch (error) {
      if (error.status === 401) onUnauthorized();
      else notify(error.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form key={open ? 'open' : 'closed'} onSubmit={submit}>
        <h3>Change password</h3>
        <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>
        <label style={{ marginTop: '.75rem' }}>New password (8+ characters)<input name="next" type="password" autoComplete="new-password" minLength="8" required /></label>
        <div className="row" style={{ marginTop: '1rem' }}><button className="primary">Save password</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function LabelDialog({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const afterPrint = () => document.body.classList.remove('printing');
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('afterprint', afterPrint);
      document.body.classList.remove('printing');
    };
  }, [item]);

  return (
    <Modal open={Boolean(item)} onClose={onClose} className="label-dialog" >
      {item && <>
        <div className="label"><img src={item.dataUrl} alt="QR code for this device" /><strong>{item.asset_id}</strong><span>{item.owner_name}</span></div>
        <div className="row"><button className="primary" onClick={() => { document.body.classList.add('printing'); window.print(); }}>Print label</button><button onClick={onClose}>Close</button></div>
      </>}
    </Modal>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(null);
  const [toast, setToast] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [label, setLabel] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const unauthorized = useCallback(() => {
    setUser(null);
    setPage(null);
    setPasswordOpen(false);
    setLabel(null);
  }, []);

  useEffect(() => {
    let active = true;
    api('/me').then((currentUser) => {
      if (!active) return;
      setUser(currentUser);
      setPage(NAV[currentUser.role][0][0]);
    }).catch(() => {
      if (active) setUser(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      clearTimeout(toastTimer.current);
    };
  }, []);

  async function login(credentials) {
    const currentUser = await api('/login', { method: 'POST', body: credentials });
    setUser(currentUser);
    setPage(NAV[currentUser.role][0][0]);
  }

  async function logout() {
    try {
      await api('/logout', { method: 'POST' });
      setUser(null);
      setPage(null);
    } catch (error) {
      if (error.status === 401) unauthorized();
      else notify(error.message);
    }
  }

  async function showLabel(id) {
    try {
      setLabel(await api('/devices/' + id + '/qr'));
    } catch (error) {
      if (error.status === 401) unauthorized();
      else notify(error.message);
    }
  }

  if (loading) return null;

  let content = null;
  if (user) {
    switch (page) {
      case 'verify': content = <VerifyView key={page} notify={notify} onUnauthorized={unauthorized} />; break;
      case 'employees': content = <EmployeesView key={page} user={user} notify={notify} onUnauthorized={unauthorized} />; break;
      case 'devices': content = <DevicesView key={page} user={user} notify={notify} onUnauthorized={unauthorized} onShowLabel={showLabel} />; break;
      case 'officers': content = <OfficersView key={page} notify={notify} onUnauthorized={unauthorized} />; break;
      case 'logs': content = <ActivityView key={page} notify={notify} onUnauthorized={unauthorized} />; break;
      default: content = null;
    }
  }

  return (
    <>
      {user
        ? <AppShell user={user} page={page} onNavigate={setPage} onChangePassword={() => setPasswordOpen(true)} onSignOut={logout}>{content}</AppShell>
        : <Login onLogin={login} />}
      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} notify={notify} onUnauthorized={unauthorized} />
      <LabelDialog item={label} onClose={() => setLabel(null)} />
      {toast && <div id="toast" role="status">{toast}</div>}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
