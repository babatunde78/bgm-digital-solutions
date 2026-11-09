'use strict';
const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'PROGRAMDATA', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']);
module.exports = function pilotEnvironment(localData, source = process.env) {
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allowed.has(name.toUpperCase()))), LOCALAPPDATA: localData };
};
