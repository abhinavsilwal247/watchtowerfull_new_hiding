// Known monitoring / remote-access / capture software. Matched (case-insensitive) against
// process name, executable path, command line, and service name/display name.
// risk: high = built to watch you covertly or for an employer; medium = can see/control your screen; low = capable but common.
const S = (category, risk, label, re) => ({ category, risk, label, re: new RegExp(re, 'i') });

export const SIGNATURES = [
  // Employee monitoring / DLP
  S('employee-monitoring', 'high', 'Tivazo', 'tivazo'),
  S('employee-monitoring', 'high', 'Teramind', 'teramind|tmagent|tm_agent'),
  S('employee-monitoring', 'high', 'ActivTrak', 'activtrak|atuser'),
  S('employee-monitoring', 'high', 'Hubstaff', 'hubstaff'),
  S('employee-monitoring', 'high', 'Time Doctor', 'timedoctor|sneakpeek'),
  S('employee-monitoring', 'high', 'Veriato / Cerebral', 'veriato|vcagent|cerebral'),
  S('employee-monitoring', 'high', 'Insightful / Workpuls', 'insightful|workpuls'),
  S('employee-monitoring', 'high', 'DeskTime', 'desktime'),
  S('employee-monitoring', 'high', 'Controlio / Kickidler / StaffCop', 'controlio|kickidler|staffcop|monitask|sentrypc|wiretap'),
  S('employee-monitoring', 'high', 'CurrentWare / Ekran / ObserveIT', 'currentware|ekran|observeit'),
  S('employee-monitoring', 'high', 'Forcepoint / Proofpoint endpoint', 'forcepoint|fpagent|proofpoint'),
  S('employee-monitoring', 'medium', 'RescueTime / Toggl tracker', 'rescuetime|toggl'),
  S('employee-monitoring', 'medium', 'EDR agent (CrowdStrike / SentinelOne / Carbon Black)', 'csfalcon|crowdstrike|sentinelagent|sentinelone|carbonblack|cbdefense'),
  S('employee-monitoring', 'medium', 'Intune / MDM management', 'intunemanagement|microsoft\\.management\\.services|omadmclient|airwatch|workspaceone'),
  // Stalkerware / keyloggers
  S('stalkerware', 'high', 'Stalkerware / spy app', 'mspy|flexispy|spyera|hoverwatch|webwatcher|spyrix|refog|kidlogger|ardamax|actualspy'),
  S('stalkerware', 'high', 'Keylogger', 'keylog|elitekeylogger'),
  // Remote access
  S('remote-access', 'medium', 'TeamViewer', 'teamviewer'),
  S('remote-access', 'medium', 'AnyDesk', 'anydesk'),
  S('remote-access', 'medium', 'RustDesk', 'rustdesk'),
  S('remote-access', 'medium', 'ScreenConnect / ConnectWise', 'screenconnect|connectwise'),
  S('remote-access', 'medium', 'Splashtop / LogMeIn / Radmin', 'splashtop|logmein|radmin'),
  S('remote-access', 'medium', 'VNC server', 'winvnc|tightvnc|ultravnc|vncserver|tvnserver'),
  S('remote-access', 'medium', 'NetSupport', 'client32|netsupport'),
  S('remote-access', 'medium', 'MeshAgent / DWService / Supremo / Ammyy', 'meshagent|dwagent|dwservice|supremo|ammyy'),
  S('remote-access', 'medium', 'Remote Assistance / Quick Assist', 'msra\\.exe|quickassist|rdpclip'),
  // Capture / recording
  S('screen-capture', 'medium', 'OBS Studio', '(^|[\\\\/ ])obs(64|32|-)'),
  S('screen-capture', 'low', 'Windows Snipping / Screen Sketch', 'snippingtool|screenclippinghost|screensketch'),
  S('screen-capture', 'low', 'Xbox Game Bar capture', 'gamebar'),
  S('screen-capture', 'medium', 'Screen recorder', 'bandicam|camtasia|sharex|screenpresso|lightshot|greenshot|screenrec|flashback|loom'),
  S('screen-capture', 'low', 'NVIDIA ShadowPlay / Share', 'nvsphelper|nvcontainer'),
  // Screen-share capable collaboration apps
  S('collaboration', 'low', 'Screen-share capable app', '(^|[\\\\/ ])(zoom|ms-teams|teams|webex|slack|discord|skype)(\\.exe|$)'),
];

const SUSPICIOUS_NAME = /(monitor|tracker|spy|stealth|surveil|snoop|watcher)/i;

// Returns { label, category, risk, reason } or null.
export function classify({ name = '', path = '', cmd = '', display = '' }) {
  const hay = [name, path, cmd, display].join(' | ');
  for (const s of SIGNATURES) {
    if (s.re.test(hay)) return { label: s.label, category: s.category, risk: s.risk, reason: 'matches known signature' };
  }
  if (SUSPICIOUS_NAME.test(`${name} ${display}`)) {
    return { label: 'Suspicious name', category: 'heuristic', risk: 'low', reason: 'name contains monitor/tracker/spy-like keyword' };
  }
  return null;
}
