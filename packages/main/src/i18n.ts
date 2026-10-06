// i18n.ts — the handful of strings the main process words itself: the View menu,
// the titles / file-type filters of the open & save dialogs, and the fallback
// names for a playlist that has none. The
// renderer owns the language choice (Settings ▸ Language, see
// renderer/entries/i18n.js) and reports it over the `app:setLocale` IPC; until it
// does we're on English. Keep the locale list in sync with LOCALES there.

const en = {
  menuView: 'View',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  actualSize: 'Actual Size',
  choosePlaylist: 'Choose a playlist',
  chooseMusicFolder: 'Choose your music folder',
  exportPlaylist: 'Export playlist',
  importPlaylist: 'Import playlist',
  filterPlaylists: 'Playlists',
  filterAllFiles: 'All files',
  filterM3u8: 'M3U8 playlist (UTF-8)',
  filterM3u: 'M3U playlist',
  untitledPlaylist: 'Untitled playlist',
  importedPlaylist: 'Imported playlist',
};

export type MessageKey = keyof typeof en;

const MESSAGES: Record<string, Record<MessageKey, string>> = {
  en,
  zh: {
    menuView: '视图',
    zoomIn: '放大',
    zoomOut: '缩小',
    actualSize: '实际大小',
    choosePlaylist: '选择播放列表',
    chooseMusicFolder: '选择音乐文件夹',
    exportPlaylist: '导出播放列表',
    importPlaylist: '导入播放列表',
    filterPlaylists: '播放列表',
    filterAllFiles: '所有文件',
    filterM3u8: 'M3U8 播放列表 (UTF-8)',
    filterM3u: 'M3U 播放列表',
    untitledPlaylist: '未命名播放列表',
    importedPlaylist: '导入的播放列表',
  },
  hi: {
    menuView: 'दृश्य',
    zoomIn: 'ज़ूम इन',
    zoomOut: 'ज़ूम आउट',
    actualSize: 'वास्तविक आकार',
    choosePlaylist: 'प्लेलिस्ट चुनें',
    chooseMusicFolder: 'अपना संगीत फ़ोल्डर चुनें',
    exportPlaylist: 'प्लेलिस्ट एक्सपोर्ट करें',
    importPlaylist: 'प्लेलिस्ट इंपोर्ट करें',
    filterPlaylists: 'प्लेलिस्ट',
    filterAllFiles: 'सभी फ़ाइलें',
    filterM3u8: 'M3U8 प्लेलिस्ट (UTF-8)',
    filterM3u: 'M3U प्लेलिस्ट',
    untitledPlaylist: 'बिना नाम की प्लेलिस्ट',
    importedPlaylist: 'इंपोर्ट की गई प्लेलिस्ट',
  },
  es: {
    menuView: 'Ver',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    actualSize: 'Tamaño real',
    choosePlaylist: 'Elige una playlist',
    chooseMusicFolder: 'Elige tu carpeta de música',
    exportPlaylist: 'Exportar playlist',
    importPlaylist: 'Importar playlist',
    filterPlaylists: 'Playlists',
    filterAllFiles: 'Todos los archivos',
    filterM3u8: 'Playlist M3U8 (UTF-8)',
    filterM3u: 'Playlist M3U',
    untitledPlaylist: 'Playlist sin título',
    importedPlaylist: 'Playlist importada',
  },
  fr: {
    menuView: 'Affichage',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    actualSize: 'Taille réelle',
    choosePlaylist: 'Choisissez une playlist',
    chooseMusicFolder: 'Choisissez votre dossier de musique',
    exportPlaylist: 'Exporter la playlist',
    importPlaylist: 'Importer une playlist',
    filterPlaylists: 'Playlists',
    filterAllFiles: 'Tous les fichiers',
    filterM3u8: 'Playlist M3U8 (UTF-8)',
    filterM3u: 'Playlist M3U',
    untitledPlaylist: 'Playlist sans titre',
    importedPlaylist: 'Playlist importée',
  },
  el: {
    menuView: 'Προβολή',
    zoomIn: 'Μεγέθυνση',
    zoomOut: 'Σμίκρυνση',
    actualSize: 'Πραγματικό μέγεθος',
    choosePlaylist: 'Επιλέξτε playlist',
    chooseMusicFolder: 'Επιλέξτε τον φάκελο με τη μουσική σας',
    exportPlaylist: 'Εξαγωγή playlist',
    importPlaylist: 'Εισαγωγή playlist',
    filterPlaylists: 'Playlists',
    filterAllFiles: 'Όλα τα αρχεία',
    filterM3u8: 'Playlist M3U8 (UTF-8)',
    filterM3u: 'Playlist M3U',
    untitledPlaylist: 'Playlist χωρίς τίτλο',
    importedPlaylist: 'Εισαγμένη playlist',
  },
  it: {
    menuView: 'Vista',
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    actualSize: 'Dimensioni reali',
    choosePlaylist: 'Scegli una playlist',
    chooseMusicFolder: 'Scegli la cartella della tua musica',
    exportPlaylist: 'Esporta playlist',
    importPlaylist: 'Importa playlist',
    filterPlaylists: 'Playlist',
    filterAllFiles: 'Tutti i file',
    filterM3u8: 'Playlist M3U8 (UTF-8)',
    filterM3u: 'Playlist M3U',
    untitledPlaylist: 'Playlist senza titolo',
    importedPlaylist: 'Playlist importata',
  },
  de: {
    menuView: 'Darstellung',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    actualSize: 'Originalgröße',
    choosePlaylist: 'Playlist auswählen',
    chooseMusicFolder: 'Musikordner auswählen',
    exportPlaylist: 'Playlist exportieren',
    importPlaylist: 'Playlist importieren',
    filterPlaylists: 'Playlists',
    filterAllFiles: 'Alle Dateien',
    filterM3u8: 'M3U8-Playlist (UTF-8)',
    filterM3u: 'M3U-Playlist',
    untitledPlaylist: 'Unbenannte Playlist',
    importedPlaylist: 'Importierte Playlist',
  },
  tr: {
    menuView: 'Görünüm',
    zoomIn: 'Yakınlaştır',
    zoomOut: 'Uzaklaştır',
    actualSize: 'Gerçek boyut',
    choosePlaylist: 'Çalma listesi seçin',
    chooseMusicFolder: 'Müzik klasörünüzü seçin',
    exportPlaylist: 'Çalma listesini dışa aktar',
    importPlaylist: 'Çalma listesini içe aktar',
    filterPlaylists: 'Çalma listeleri',
    filterAllFiles: 'Tüm dosyalar',
    filterM3u8: 'M3U8 çalma listesi (UTF-8)',
    filterM3u: 'M3U çalma listesi',
    untitledPlaylist: 'Adsız çalma listesi',
    importedPlaylist: 'İçe aktarılan çalma listesi',
  },
  ru: {
    menuView: 'Вид',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    actualSize: 'Фактический размер',
    choosePlaylist: 'Выберите плейлист',
    chooseMusicFolder: 'Выберите папку с музыкой',
    exportPlaylist: 'Экспорт плейлиста',
    importPlaylist: 'Импорт плейлиста',
    filterPlaylists: 'Плейлисты',
    filterAllFiles: 'Все файлы',
    filterM3u8: 'Плейлист M3U8 (UTF-8)',
    filterM3u: 'Плейлист M3U',
    untitledPlaylist: 'Плейлист без названия',
    importedPlaylist: 'Импортированный плейлист',
  },
  ja: {
    menuView: '表示',
    zoomIn: '拡大',
    zoomOut: '縮小',
    actualSize: '実際のサイズ',
    choosePlaylist: 'プレイリストを選択',
    chooseMusicFolder: '音楽フォルダを選択',
    exportPlaylist: 'プレイリストをエクスポート',
    importPlaylist: 'プレイリストをインポート',
    filterPlaylists: 'プレイリスト',
    filterAllFiles: 'すべてのファイル',
    filterM3u8: 'M3U8 プレイリスト (UTF-8)',
    filterM3u: 'M3U プレイリスト',
    untitledPlaylist: '名称未設定プレイリスト',
    importedPlaylist: 'インポートしたプレイリスト',
  },
};

let locale = 'en';
const listeners = new Set<() => void>();

/** The native string for `key` in the active language. */
export function t(key: MessageKey): string {
  return MESSAGES[locale][key];
}

/** Switch language. Unknown locales are ignored (we stay where we are). */
export function setLocale(next: string): void {
  if (!Object.hasOwn(MESSAGES, next) || next === locale) return;
  locale = next;
  listeners.forEach(fn => fn());
}

/** Run `fn` whenever the language changes (e.g. to rebuild the app menu). */
export function onLocaleChange(fn: () => void): void {
  listeners.add(fn);
}
