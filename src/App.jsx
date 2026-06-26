import { useState, useEffect } from 'react';
import { formatDistanceToNow, subHours, subMinutes, differenceInMinutes, addMinutes, format } from 'date-fns';
import { Download, Upload, Settings, X, CheckCircle2, Clock, AlertTriangle, Sun, Moon, RotateCcw, Trash2, HelpCircle, Eye, EyeOff } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, LabelList } from 'recharts';

// Utility functions for localStorage
const getStoredUsers = () => {
  const users = localStorage.getItem('alcoholTracker');
  return users ? JSON.parse(users) : {};
};

const getStoredWaitingTime = () => {
  const time = localStorage.getItem('waitingTime');
  return time ? parseInt(time, 10) : 60; // Default 60 minutes
};

const saveUsers = (users) => {
  localStorage.setItem('alcoholTracker', JSON.stringify(users));
};

const saveWaitingTime = (minutes) => {
  localStorage.setItem('waitingTime', minutes.toString());
};

// Percentage thresholds (of the wait still remaining), persisted in localStorage
const getStoredPct = (key, fallback) => {
  const v = localStorage.getItem(key);
  const n = v != null ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const getInitialTheme = () => {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) { /* ignore */ }
  return 'light';
};

// Normalize a user ID so entry/search is case-insensitive
const normalizeId = (id) => id.trim().toLowerCase();

// Preset amount (ml) shortcuts for quick entry
const AMOUNT_PRESETS = [0.25, 0.5, 0.75, 0.8, 0.9, 1, 1.2, 1.5];

// Default settings values (used by "Reset to defaults")
const DEFAULT_WAITING_MINUTES = 60;
const DEFAULT_ALMOST_READY_PCT = 11;
const DEFAULT_CONFIRM_PCT = 89;

const calculateRecentConsumption = (records, hoursAgo) => {
  const now = new Date();
  const cutoffTime = subHours(now, hoursAgo);
  return records
    .filter(record => new Date(record.timestamp) > cutoffTime)
    .reduce((sum, record) => sum + record.amount, 0);
};

// Build the "last 6 hours" chart data as rolling windows ending at now
const CHART_BUCKET_MINUTES = 30;
const CHART_BUCKETS = 12; // 12 x 30 min = 6 hours

const buildRecentChartData = (records) => {
  const now = new Date();
  const buckets = [];
  for (let i = CHART_BUCKETS - 1; i >= 0; i--) {
    const end = subMinutes(now, i * CHART_BUCKET_MINUTES);
    const start = subMinutes(end, CHART_BUCKET_MINUTES);
    buckets.push({ start, end, total: 0 });
  }
  records.forEach((r) => {
    const t = new Date(r.timestamp);
    for (const b of buckets) {
      if (t > b.start && t <= b.end) {
        b.total += r.amount;
        break;
      }
    }
  });
  return buckets.map((b) => ({ time: format(b.end, 'h:mm'), ml: Math.round(b.total * 100) / 100 }));
};

const getWaitingTime = (lastConsumptionTime, waitingMinutes) => {
  const now = new Date();
  const waitTimeAfterLast = addMinutes(new Date(lastConsumptionTime), waitingMinutes);
  const waitMinutes = differenceInMinutes(waitTimeAfterLast, now);
  return waitMinutes > 0 ? waitMinutes : 0;
};

// Build the export payload: the full dataset (all users + records) as JSON.
// Lossless and import-ready — restores the exact dataset on another device.
const buildDataExport = () => JSON.stringify({
  app: 'alcohol-tracker',
  type: 'dataset',
  version: 1,
  exportedAt: new Date().toISOString(),
  users: getStoredUsers(),
});

const triggerDownload = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Base64-encode a byte buffer (chunked to stay within call-stack limits)
const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const PBKDF2_ITERATIONS = 250000;

// Encrypt text with a passphrase: PBKDF2-SHA256 -> AES-256-GCM
const encryptText = async (plaintext, passphrase) => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    format: 'alcohol-tracker-encrypted',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
};

// Encrypt the full dataset and download it as an encrypted .json envelope
const downloadEncryptedData = async (passphrase) => {
  const data = buildDataExport();
  const payload = await encryptText(data, passphrase);
  const filename = `alcohol_tracker_backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
  triggerDownload(JSON.stringify(payload, null, 2), filename, 'application/json');
};

const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Decrypt an encrypted-export payload back to plaintext (throws on wrong passphrase)
const decryptText = async (payload, passphrase) => {
  const enc = new TextEncoder();
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: payload.iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
};

// Merge imported users into existing ones: normalize IDs to lowercase, merge
// records, drop exact duplicates (same timestamp+amount), and sort chronologically
const normalizeAndMerge = (existingUsers, importedUsers) => {
  const result = {};
  const add = (id, recs) => {
    const key = normalizeId(id);
    result[key] = [...(result[key] || []), ...(Array.isArray(recs) ? recs : [])];
  };
  Object.entries(existingUsers).forEach(([id, recs]) => add(id, recs));
  Object.entries(importedUsers).forEach(([id, recs]) => add(id, recs));
  Object.keys(result).forEach((key) => {
    const seen = new Set();
    result[key] = result[key]
      .filter((r) => {
        const sig = `${r.timestamp}|${r.amount}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  });
  return result;
};

// Node.js snippet shown in the help popup for decrypting an export
const DECRYPT_SNIPPET = `const fs = require('fs');
const crypto = require('crypto');

const pass = 'YOUR_PASSPHRASE';
const f = JSON.parse(fs.readFileSync('backup.json', 'utf8'));
const salt = Buffer.from(f.salt, 'base64');
const iv = Buffer.from(f.iv, 'base64');
const blob = Buffer.from(f.ciphertext, 'base64');
const data = blob.subarray(0, blob.length - 16);   // ciphertext
const tag = blob.subarray(blob.length - 16);        // GCM auth tag
const key = crypto.pbkdf2Sync(pass, salt, f.iterations, 32, 'sha256');
const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(tag);
const json = Buffer.concat([d.update(data), d.final()]).toString('utf8');
fs.writeFileSync('decrypted.json', json);
console.log('Wrote decrypted.json');`;

// Shared style tokens
const card = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700/70 dark:bg-gray-800/60';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-medium text-white transition-colors hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-100 dark:bg-teal-600 dark:hover:bg-teal-500 dark:focus-visible:ring-offset-gray-950';
const inputCls =
  'w-full min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 transition focus:border-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500';

export default function App() {
  const [userId, setUserId] = useState('');
  const [showNewUserPrompt, setShowNewUserPrompt] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [amount, setAmount] = useState('');
  const [records, setRecords] = useState([]);
  const [waitingMinutes, setWaitingMinutes] = useState(getStoredWaitingTime());
  const [almostReadyPct, setAlmostReadyPct] = useState(() => getStoredPct('almostReadyPct', 11));
  const [confirmPct, setConfirmPct] = useState(() => getStoredPct('confirmPct', 89));
  const [suggestions, setSuggestions] = useState([]);
  const [isInputActive, setIsInputActive] = useState(false);
  const [allUserIds, setAllUserIds] = useState([]);
  const [selectedLetter, setSelectedLetter] = useState('all');
  const [justRecorded, setJustRecorded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(null); // null | 'defaults' | 'data'
  const [showEncryptPrompt, setShowEncryptPrompt] = useState(false);
  const [showEncryptHelp, setShowEncryptHelp] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [encryptBusy, setEncryptBusy] = useState(false);
  const [encryptError, setEncryptError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importMode, setImportMode] = useState('merge'); // 'merge' | 'replace'
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);

  // Apply theme to <html> and persist
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('theme', theme); } catch (e) { /* ignore */ }
  }, [theme]);

  // One-time migration: lowercase any existing user IDs, merging duplicates
  useEffect(() => {
    const users = getStoredUsers();
    let changed = false;
    const migrated = {};
    Object.entries(users).forEach(([id, userRecords]) => {
      const key = normalizeId(id);
      if (key !== id) changed = true;
      migrated[key] = migrated[key] ? [...migrated[key], ...userRecords] : userRecords;
    });
    if (changed) {
      Object.keys(migrated).forEach(key => {
        migrated[key].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      });
      saveUsers(migrated);
    }
    setAllUserIds(Object.keys(migrated).sort());
  }, []);

  // Get suggestions based on input
  useEffect(() => {
    if (userId.trim()) {
      const users = getStoredUsers();
      const matches = Object.keys(users).filter(id =>
        id.toLowerCase().includes(userId.toLowerCase())
      );
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  }, [userId]);

  // Load and display user data when ID is entered
  const handleSearch = (selectedId = userId) => {
    const id = normalizeId(selectedId);
    if (!id) return;
    // Close the autocomplete dropdown so it doesn't cover messages below
    setIsInputActive(false);
    setSuggestions([]);
    // Viewing a user (vs. just recording) shows the wait warning, not the green confirmation
    setJustRecorded(false);
    const users = getStoredUsers();
    if (users[id]) {
      setCurrentUser(id);
      setRecords(users[id]);
      setShowNewUserPrompt(false);
      setUserId(id);
    } else {
      setShowNewUserPrompt(true);
      setCurrentUser(null);
      setRecords([]);
    }
  };

  // Handle suggestion selection
  const handleSuggestionClick = (suggestion) => {
    handleSearch(suggestion);
  };

  // Create new user
  const handleCreateUser = () => {
    const id = normalizeId(userId);
    if (!id) return;
    const users = getStoredUsers();
    users[id] = users[id] || [];
    saveUsers(users);
    setAllUserIds(Object.keys(users).sort());
    setJustRecorded(false);
    setCurrentUser(id);
    setRecords(users[id]);
    setUserId(id);
    setShowNewUserPrompt(false);
  };

  // Actually save the record
  const commitRecord = () => {
    if (!amount || !currentUser) return;
    const users = getStoredUsers();
    const newRecord = {
      timestamp: new Date().toISOString(),
      amount: parseFloat(amount)
    };

    users[currentUser] = [...(users[currentUser] || []), newRecord];
    saveUsers(users);
    setRecords(users[currentUser]);
    setAmount('');
    setJustRecorded(true);
    setShowConfirm(false);
  };

  // Add new consumption record — confirm first if the last drink was very recent
  const handleAddRecord = (e) => {
    e.preventDefault();
    if (!amount || !currentUser) return;
    // Most of the wait still remaining => they just drank; confirm before adding another
    if (lastConsumptionTime && waitingMinutes > 0 && waitingTimeNeeded / waitingMinutes >= confirmPct / 100) {
      setShowConfirm(true);
      return;
    }
    commitRecord();
  };

  // Cancel the "add another drink?" prompt and clear the entered amount
  const cancelConfirm = () => {
    setShowConfirm(false);
    setAmount('');
  };

  // Reset settings (waiting time + thresholds) to their defaults
  const handleResetDefaults = () => {
    setWaitingMinutes(DEFAULT_WAITING_MINUTES);
    saveWaitingTime(DEFAULT_WAITING_MINUTES);
    setAlmostReadyPct(DEFAULT_ALMOST_READY_PCT);
    localStorage.setItem('almostReadyPct', String(DEFAULT_ALMOST_READY_PCT));
    setConfirmPct(DEFAULT_CONFIRM_PCT);
    localStorage.setItem('confirmPct', String(DEFAULT_CONFIRM_PCT));
    setResetConfirm(null);
  };

  // Permanently delete all users and their records
  const handleResetData = () => {
    saveUsers({});
    setAllUserIds([]);
    setCurrentUser(null);
    setRecords([]);
    setUserId('');
    setSuggestions([]);
    setShowNewUserPrompt(false);
    setJustRecorded(false);
    setSelectedLetter('all');
    setResetConfirm(null);
  };

  // Encrypt the all-users CSV with the entered passphrase and download it
  const handleEncryptDownload = async () => {
    if (!passphrase) {
      setEncryptError('Please enter a passphrase.');
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setEncryptError("Passphrases don't match.");
      return;
    }
    try {
      setEncryptBusy(true);
      setEncryptError('');
      await downloadEncryptedData(passphrase);
      setShowEncryptPrompt(false);
      setPassphrase('');
      setPassphraseConfirm('');
      setShowPass1(false);
      setShowPass2(false);
    } catch (err) {
      setEncryptError('Encryption failed: ' + (err && err.message ? err.message : 'unknown error'));
    } finally {
      setEncryptBusy(false);
    }
  };

  const cancelEncrypt = () => {
    setShowEncryptPrompt(false);
    setPassphrase('');
    setPassphraseConfirm('');
    setShowPass1(false);
    setShowPass2(false);
    setEncryptError('');
  };

  // Decrypt a backup file with the entered passphrase and merge it into the data
  const handleImport = async () => {
    if (!importFile) { setImportError('Choose a backup file.'); return; }
    if (!importPassphrase) { setImportError('Enter the passphrase.'); return; }
    try {
      setImportBusy(true);
      setImportError('');
      setImportSuccess('');
      const text = await importFile.text();
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('That file is not a valid backup (not JSON).'); }
      if (!payload || !payload.ciphertext || !payload.salt || !payload.iv || !payload.iterations) {
        throw new Error('That file is not a recognized encrypted backup.');
      }
      let plaintext;
      try {
        plaintext = await decryptText(payload, importPassphrase);
      } catch {
        throw new Error('Incorrect passphrase, or the file is corrupted.');
      }
      let dataset;
      try { dataset = JSON.parse(plaintext); } catch { throw new Error('Decrypted data is not valid.'); }
      const importedUsers = dataset && typeof dataset.users === 'object' && dataset.users ? dataset.users : null;
      if (!importedUsers) throw new Error('Decrypted file is not a valid dataset.');

      // Merge into existing, or replace existing entirely (still normalize + dedup)
      const base = importMode === 'replace' ? {} : getStoredUsers();
      const merged = normalizeAndMerge(base, importedUsers);
      saveUsers(merged);
      setAllUserIds(Object.keys(merged).sort());
      const n = Object.keys(importedUsers).length;
      setImportSuccess(
        importMode === 'replace'
          ? `Replaced all data with ${n} imported user${n === 1 ? '' : 's'}.`
          : `Imported and merged ${n} user${n === 1 ? '' : 's'}.`
      );
      setImportFile(null);
      setImportPassphrase('');
      // Refresh the currently-viewed user (if any) from the merged data
      if (currentUser) {
        const key = normalizeId(currentUser);
        setRecords(merged[key] || []);
        setCurrentUser(merged[key] ? key : null);
      }
    } catch (err) {
      setImportError(err && err.message ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  };

  const cancelImport = () => {
    setShowImport(false);
    setImportFile(null);
    setImportPassphrase('');
    setImportMode('merge');
    setImportError('');
    setImportSuccess('');
  };

  // Handle waiting time change
  const handleWaitingTimeChange = (e) => {
    const newTime = parseInt(e.target.value, 10);
    if (newTime > 0) {
      setWaitingMinutes(newTime);
      saveWaitingTime(newTime);
    }
  };

  // Handle threshold (%) changes
  const handleAlmostReadyPctChange = (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      setAlmostReadyPct(n);
      localStorage.setItem('almostReadyPct', String(n));
    }
  };
  const handleConfirmPctChange = (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      setConfirmPct(n);
      localStorage.setItem('confirmPct', String(n));
    }
  };

  const totalConsumption = records.reduce((sum, record) => sum + record.amount, 0);
  const last2HoursConsumption = calculateRecentConsumption(records, 2);
  const lastConsumptionTime = records.length > 0 ? records[records.length - 1].timestamp : null;
  const waitingTimeNeeded = lastConsumptionTime ? getWaitingTime(lastConsumptionTime, waitingMinutes) : 0;
  const nextAllowedTime = lastConsumptionTime
    ? format(addMinutes(new Date(lastConsumptionTime), waitingMinutes), 'h:mm a')
    : null;
  const hasRecords = !!currentUser && records.length > 0;
  // Still inside the waiting window (more time needed before the next drink)
  const withinWaitWindow = !!currentUser && !!lastConsumptionTime && waitingTimeNeeded > 0;
  // Remaining wait has dropped below the configured "almost ready" percentage
  const isAlmostReady = withinWaitWindow && waitingMinutes > 0 && waitingTimeNeeded / waitingMinutes < almostReadyPct / 100;

  // Quick-select: first letter (non-letters grouped under '#'), letter tabs, and filtered list
  const firstLetterOf = (id) => {
    const c = id.charAt(0).toUpperCase();
    return c >= 'A' && c <= 'Z' ? c : '#';
  };
  const letterTabs = ['all', ...Array.from(new Set(allUserIds.map(firstLetterOf))).sort()];
  const filteredUserIds = selectedLetter === 'all'
    ? allUserIds
    : allUserIds.filter((id) => firstLetterOf(id) === selectedLetter);

  // Chart: ml per 30-min window over the last 6 hours
  const chartData = buildRecentChartData(records);
  const last6hTotal = chartData.reduce((sum, d) => sum + d.ml, 0);
  const isDark = theme === 'dark';
  const barColor = isDark ? '#2dd4bf' : '#0f766e'; // teal-400 / teal-700
  const axisColor = isDark ? '#9ca3af' : '#6b7280'; // gray-400 / gray-500

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Config modal */}
      {showConfig && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
          onClick={() => setShowConfig(false)}
        >
          <div
            className={`${card} w-full max-w-sm p-6`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">Settings</h2>
              <button
                onClick={() => setShowConfig(false)}
                className="-m-2 rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:text-white"
                aria-label="Close settings"
              >
                <X size={22} />
              </button>
            </div>

            {/* Appearance */}
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Appearance</h3>
              <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-900">
                {[
                  { key: 'light', label: 'Light', Icon: Sun },
                  { key: 'dark', label: 'Dark', Icon: Moon },
                ].map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTheme(key)}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                      theme === key
                        ? 'bg-white text-teal-700 shadow-sm dark:bg-gray-700 dark:text-teal-300'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Waiting Time */}
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Waiting Time</h3>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  value={waitingMinutes}
                  onChange={handleWaitingTimeChange}
                  min="1"
                  className={`${inputCls} w-24 tabular-nums`}
                />
                <span className="text-gray-600 dark:text-gray-300">minutes between drinks</span>
              </div>
            </div>

            {/* Thresholds */}
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Thresholds <span className="font-normal normal-case">(% of wait remaining)</span>
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={almostReadyPct}
                    onChange={handleAlmostReadyPctChange}
                    min="0"
                    max="100"
                    className={`${inputCls} w-20 tabular-nums`}
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    Show <span className="font-medium text-gray-900 dark:text-gray-100">“Almost ready”</span> when below this %
                  </span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={confirmPct}
                    onChange={handleConfirmPctChange}
                    min="0"
                    max="100"
                    className={`${inputCls} w-20 tabular-nums`}
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-gray-900 dark:text-gray-100">Confirm</span> a new drink when above this %
                  </span>
                </label>
              </div>
            </div>

            <div className="my-5 border-t border-gray-200 dark:border-gray-700" />

            {/* Download all users (encrypted) + help */}
            <div className="flex gap-2">
              <button
                onClick={() => { setEncryptError(''); setShowEncryptPrompt(true); }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Download size={18} />
                Download All Users Data
              </button>
              <button
                onClick={() => setShowEncryptHelp(true)}
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white px-3 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                title="How encryption works"
                aria-label="How encryption works"
              >
                <HelpCircle size={20} />
              </button>
            </div>

            <button
              onClick={() => { setImportError(''); setImportSuccess(''); setShowImport(true); }}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Upload size={18} />
              Import Backup
            </button>

            <div className="my-5 border-t border-gray-200 dark:border-gray-700" />

            <div className="space-y-2">
              <button
                onClick={() => setResetConfirm('defaults')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <RotateCcw size={18} />
                Reset to Defaults
              </button>
              <button
                onClick={() => setResetConfirm('data')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-5 py-3 font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-800/70 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 size={18} />
                Reset Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation */}
      {resetConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
          onClick={() => setResetConfirm(null)}
        >
          <div className={`${card} w-full max-w-sm p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex gap-3">
              <AlertTriangle
                className={`mt-0.5 shrink-0 ${resetConfirm === 'data' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
                size={22}
              />
              <div>
                <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">
                  {resetConfirm === 'data' ? 'Reset all data?' : 'Reset settings to defaults?'}
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {resetConfirm === 'data'
                    ? 'This permanently deletes all users and their records. This cannot be undone.'
                    : `Waiting time and thresholds will return to their defaults (${DEFAULT_WAITING_MINUTES} min, ${DEFAULT_ALMOST_READY_PCT}% / ${DEFAULT_CONFIRM_PCT}%).`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResetConfirm(null)}
                className="flex-1 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              {resetConfirm === 'data' ? (
                <button
                  onClick={handleResetData}
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-100 dark:focus-visible:ring-offset-gray-950"
                >
                  Delete all
                </button>
              ) : (
                <button onClick={handleResetDefaults} className={`${primaryBtn} flex-1`}>
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* "Add another drink?" confirmation */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
          onClick={cancelConfirm}
        >
          <div className={`${card} w-full max-w-sm p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={22} />
              <div>
                <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">Add another drink?</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  It's recommended to wait until <span className="font-medium text-gray-900 dark:text-gray-100">{nextAllowedTime}</span> (about {waitingTimeNeeded} min from now) before the next drink.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={cancelConfirm}
                className="flex-1 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                No
              </button>
              <button onClick={commitRecord} className={`${primaryBtn} flex-1`}>
                Yes, add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encrypt & download passphrase prompt */}
      {showEncryptPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
          onClick={cancelEncrypt}
        >
          <div className={`${card} w-full max-w-sm p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">Encrypt &amp; download</h2>
              <button
                onClick={cancelEncrypt}
                className="-m-2 rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:text-white"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              Enter a passphrase. Your full dataset is encrypted with it (AES-256-GCM) for backup/transfer to another device. You'll need this exact passphrase to restore it — it cannot be recovered.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleEncryptDownload(); }} className="space-y-3">
              <div className="relative">
                <input
                  type={showPass1 ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Passphrase"
                  autoComplete="new-password"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass1((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:text-teal-600 dark:hover:text-white"
                  aria-label={showPass1 ? 'Hide passphrase' : 'Show passphrase'}
                  tabIndex={-1}
                >
                  {showPass1 ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPass2 ? 'text' : 'password'}
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                  placeholder="Confirm passphrase"
                  autoComplete="new-password"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass2((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:text-teal-600 dark:hover:text-white"
                  aria-label={showPass2 ? 'Hide passphrase' : 'Show passphrase'}
                  tabIndex={-1}
                >
                  {showPass2 ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {encryptError && <p className="text-sm text-red-600 dark:text-red-400">{encryptError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelEncrypt}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button type="submit" disabled={encryptBusy} className={`${primaryBtn} flex-1 disabled:opacity-60`}>
                  {encryptBusy ? 'Encrypting…' : 'Encrypt & Download'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import backup */}
      {showImport && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
          onClick={cancelImport}
        >
          <div className={`${card} w-full max-w-sm p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">Import backup</h2>
              <button
                onClick={cancelImport}
                className="-m-2 rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:text-white"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              Choose an encrypted backup file and enter its passphrase. User names are normalized to lowercase on import.
            </p>
            <div className="mb-3">
              <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-900">
                {[{ key: 'merge', label: 'Merge' }, { key: 'replace', label: 'Replace' }].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setImportMode(key)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                      importMode === key
                        ? 'bg-white text-teal-700 shadow-sm dark:bg-gray-700 dark:text-teal-300'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {importMode === 'merge'
                  ? 'Adds imported users to the current data; exact duplicate records are skipped.'
                  : 'Deletes all current data first, then loads only the imported data.'}
              </p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleImport(); }} className="space-y-3">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => { setImportFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); setImportError(''); setImportSuccess(''); }}
                className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-700 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-teal-800 dark:text-gray-300 dark:file:bg-teal-600 dark:hover:file:bg-teal-500"
              />
              <input
                type="password"
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
                placeholder="Passphrase"
                autoComplete="off"
                className={inputCls}
              />
              {importError && <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>}
              {importSuccess && <p className="text-sm text-green-700 dark:text-green-400">{importSuccess}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelImport}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {importSuccess ? 'Done' : 'Cancel'}
                </button>
                <button type="submit" disabled={importBusy} className={`${primaryBtn} flex-1 disabled:opacity-60`}>
                  {importBusy ? 'Importing…' : 'Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Encryption help */}
      {showEncryptHelp && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
          onClick={() => setShowEncryptHelp(false)}
        >
          <div className={`${card} max-h-[85vh] w-full max-w-lg overflow-y-auto p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold text-gray-900 dark:text-white">How the encryption works</h2>
              <button
                onClick={() => setShowEncryptHelp(false)}
                className="-m-2 rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:text-white"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <p>The export is your full dataset (all users and records) as JSON, encrypted with a passphrase you choose, using the browser's built-in Web Crypto API. The file is encrypted-only — it contains no readable data, just the cipher parameters and ciphertext.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Cipher: <span className="font-medium text-gray-900 dark:text-gray-100">AES-256-GCM</span> (authenticated encryption).</li>
                <li>Key derivation: <span className="font-medium text-gray-900 dark:text-gray-100">PBKDF2-SHA256</span>, {PBKDF2_ITERATIONS.toLocaleString()} iterations, with a random 16-byte salt.</li>
                <li>A fresh random 12-byte IV is generated for every export.</li>
              </ul>
              <p>
                The downloaded <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">.json</code> file stores
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">algorithm</code>,
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">kdf</code>,
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">iterations</code>,
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">salt</code>,
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">iv</code>, and
                {' '}<code className="rounded bg-gray-100 px-1 dark:bg-gray-700">ciphertext</code> (salt, iv and ciphertext are base64).
                The passphrase itself is never stored — keep it safe, it cannot be recovered.
              </p>
              <p className="font-medium text-gray-900 dark:text-gray-100">To decrypt (Node.js):</p>
              <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">{DECRYPT_SNIPPET}</pre>
              <p>Replace <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">YOUR_PASSPHRASE</code> and the input filename, then run it with Node. It writes <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">decrypted.json</code> — the full dataset, ready to import.</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-8">
        <div className={`mx-auto ${hasRecords ? 'max-w-md md:max-w-4xl' : 'max-w-md'}`}>
          {/* Header */}
          <header className="mb-8 flex items-start justify-between gap-3 border-b border-gray-200 pb-5 dark:border-gray-800">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal-700 dark:text-teal-400">Beverage Monitoring</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl dark:text-white">
                Alcohol Tracker
              </h1>
            </div>
            <button
              onClick={() => setShowConfig(true)}
              className="-m-1 shrink-0 rounded-xl p-3 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={24} />
            </button>
          </header>

          <div className={hasRecords ? 'md:grid md:grid-cols-2 md:gap-6 md:items-start' : ''}>
            {/* Controls column */}
            <div>
              {/* Quick name selector: A–Z filter + tappable name chips */}
              {allUserIds.length > 0 && (
                <div className="mb-6">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Select a name</h2>
                  <div className="flex gap-1 overflow-x-auto -mx-1 px-1 py-1">
                    {letterTabs.map((letter) => (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => setSelectedLetter(letter)}
                        className={`shrink-0 min-w-[2.5rem] rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                          selectedLetter === letter
                            ? 'bg-teal-700 text-white dark:bg-teal-600'
                            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {letter === 'all' ? 'All' : letter}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 flex max-h-56 flex-wrap gap-2 overflow-y-auto -mx-1 px-1 py-1">
                    {filteredUserIds.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleSearch(name)}
                        className={`rounded-xl px-3 py-2 text-base transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                          currentUser === name
                            ? 'bg-teal-700 text-white dark:bg-teal-600'
                            : 'border border-gray-200 bg-white text-gray-700 hover:border-teal-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-teal-500'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* User ID Input with Autocomplete */}
              <div className="relative mb-6">
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    onFocus={() => setIsInputActive(true)}
                    placeholder="Enter User ID"
                    className={inputCls}
                  />
                  <button onClick={() => handleSearch()} className={`${primaryBtn} shrink-0`}>
                    Search
                  </button>
                </div>

                {/* Suggestions dropdown */}
                {suggestions.length > 0 && isInputActive && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className="cursor-pointer px-4 py-3 text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                        onClick={() => handleSuggestionClick(suggestion)}
                      >
                        {suggestion}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* New User Prompt */}
              {showNewUserPrompt && (
                <div className={`${card} mb-6 p-4`}>
                  <p className="text-gray-700 dark:text-gray-200">User not found. Would you like to create a new user?</p>
                  <button onClick={handleCreateUser} className={`${primaryBtn} mt-3 w-full sm:w-auto`}>
                    Create New User
                  </button>
                </div>
              )}

              {/* Green confirmation — only right after clicking Add Record */}
              {currentUser && justRecorded && withinWaitWindow && (
                <div className="mb-6 flex gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800/70 dark:bg-green-900/25 dark:text-green-200">
                  <CheckCircle2 className="mt-0.5 shrink-0" size={20} />
                  <div>
                    <p className="font-semibold">Amount recorded</p>
                    <p className="text-sm opacity-90">
                      The next drink can be taken at <span className="font-medium">{nextAllowedTime}</span> (about {waitingTimeNeeded} min from now).
                    </p>
                  </div>
                </div>
              )}

              {/* Wait warning when viewing an existing user within the waiting window */}
              {currentUser && !justRecorded && withinWaitWindow && (
                isAlmostReady ? (
                  <div className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/25 dark:text-amber-200">
                    <Clock className="mt-0.5 shrink-0" size={20} />
                    <div>
                      <p className="font-semibold">Almost ready</p>
                      <p className="text-sm opacity-90">
                        About {waitingTimeNeeded} min left — the next drink can be taken at <span className="font-medium">{nextAllowedTime}</span>.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800/70 dark:bg-red-900/25 dark:text-red-200">
                    <AlertTriangle className="mt-0.5 shrink-0" size={20} />
                    <div>
                      <p className="font-semibold">Please wait</p>
                      <p className="text-sm opacity-90">
                        About {waitingTimeNeeded} more minutes — the next drink can be taken at <span className="font-medium">{nextAllowedTime}</span>.
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Add Record Form */}
              {currentUser && (
                <div className={`${card} mb-6 p-5`}>
                  <h2 className="mb-3 font-serif text-xl font-semibold text-gray-900 dark:text-white">
                    Add record <span className="font-sans text-base font-normal text-gray-500 dark:text-gray-400">· {currentUser}</span>
                  </h2>
                  <form onSubmit={handleAddRecord} className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Amount (ml)"
                      min="0"
                      step="0.01"
                      className={`${inputCls} tabular-nums`}
                    />
                    <button type="submit" className={`${primaryBtn} shrink-0`}>
                      Add Record
                    </button>
                  </form>
                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {AMOUNT_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(preset.toString())}
                        className="rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-base tabular-nums text-gray-700 transition-colors hover:border-teal-400 hover:bg-white active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-teal-500 dark:hover:bg-gray-800"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Data column */}
            <div>
              {/* Consumption Statistics */}
              {currentUser && records.length > 0 && (
                <div className={`${card} mb-6 p-5`}>
                  <h2 className="mb-4 font-serif text-xl font-semibold text-gray-900 dark:text-white">Statistics</h2>
                  <dl className="space-y-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Total consumption</dt>
                      <dd className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{totalConsumption.toFixed(2)} ml</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Last 2 hours</dt>
                      <dd className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{last2HoursConsumption.toFixed(2)} ml</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">Time since last drink</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">{formatDistanceToNow(new Date(records[records.length - 1].timestamp))}</dd>
                    </div>
                  </dl>

                  {/* Last 6 hours, ml per 30-min window */}
                  <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
                    <p className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">Last 6 hours</p>
                    {last6hTotal > 0 ? (
                      <ResponsiveContainer width="100%" height={110}>
                        <BarChart data={chartData} margin={{ top: 16, right: 6, bottom: 0, left: 6 }}>
                          <XAxis
                            dataKey="time"
                            tickLine={false}
                            axisLine={false}
                            interval={1}
                            tick={{ fontSize: 10, fill: axisColor }}
                          />
                          <Bar dataKey="ml" fill={barColor} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                            <LabelList
                              dataKey="ml"
                              position="top"
                              formatter={(v) => (v > 0 ? v : '')}
                              style={{ fontSize: 9, fill: axisColor }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">No consumption in the last 6 hours.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Records Display */}
              {currentUser && records.length > 0 && (
                <div className={`${card} mb-6 p-5`}>
                  <h2 className="mb-3 font-serif text-xl font-semibold text-gray-900 dark:text-white">Records</h2>
                  <div className="md:max-h-[55vh] md:overflow-y-auto">
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                      {records.map((record, index) => (
                        <li key={index} className="flex items-baseline justify-between gap-4 py-3">
                          <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{record.amount.toFixed(2)} ml</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{new Date(record.timestamp).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
