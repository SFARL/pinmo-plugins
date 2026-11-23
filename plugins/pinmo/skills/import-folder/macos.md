# Pinmo import tool for macOS

This is the `import-folder` skill's tool on macOS. It does what the `pinmo` command-line tool does (same commands, same output, same exit codes) using only what ships with macOS:

- `osascript -l JavaScript` (JavaScript for Automation) runs it.
- ImageIO reads each photo's capture time, time zone and GPS, turns the pixels upright, and makes the two resized copies.
- `shasum` hashes the photos, `curl` talks to Pinmo, and `open` shows the consent page in the browser.

The original photos never leave the computer: only the two copies are uploaded, with every APP1 (Exif, XMP) and APP13 (IPTC) block removed, plus the capture time and GPS read here. The login is kept in `~/.config/pinmo/credentials.json` (folder `0700`, file `0600`), the same file the `pinmo` CLI uses. Tokens are written only to that file and to a private temporary folder for each request, and are never printed or passed on a command line.

## Run it

Copy the code block below into a new private folder and run it. `SKILL.md` gives the exact commands. The extraction keeps the lines between the line ```` ```js pinmo ```` and the next line that is exactly ```` ``` ````.

```
osascript -l JavaScript "<folder>/pinmo.js" <command> [arguments] [--origin <url>]
```

The commands are `login [--no-browser]`, `import <folder> [--agent-fills]`, `drafts <import-id> <folder>`, `suggest <draft-id> --place <name> [--tag <tag>]...`, `status <import-id>`, `logout` and `help`. Two more, `meta <photo>` and `variant <photo> <out.jpg> display|thumb`, print what the tool reads from one photo or write one resized copy, so the result can be checked without uploading anything.

```js pinmo
// Pinmo import tool for macOS (JavaScript for Automation). Mirrors the pinmo CLI: same commands, output and exit codes.
ObjC.import("Foundation");
ObjC.import("ImageIO");
ObjC.import("stdlib");

const app = Application.currentApplication();
app.includeStandardAdditions = true;

const DEFAULT_ORIGIN = "https://pinmo.me";
const AGENT_API_PATH = "/agent-api";
const VARIANT_LIMITS = { display: { maxEdge: 2048, quality: 0.82 }, thumb: { maxEdge: 400, quality: 0.75 } };
const MAX_PHOTOS_PER_IMPORT = 200;
const MAX_RETRIES = 6;

const USAGE = [
  "Usage: pinmo <command> [--origin <url>]   (default origin " + DEFAULT_ORIGIN + ")",
  "",
  "Commands:",
  "  pinmo login [--no-browser]          Allow this computer to import photos into your Pinmo account",
  "                                      (--no-browser: only print the address, e.g. over SSH)",
  "  pinmo import <folder> [--agent-fills]",
  "                                      Import the folder's JPEGs as drafts, sorted into cards",
  "  pinmo drafts <import-id> <folder>   List the import's drafts with their files in the folder",
  "  pinmo suggest <draft-id> --place <name> [--tag <tag>]...",
  "                                      Suggest a place name (and base tags) for one draft",
  "  pinmo status <import-id>            Show the import's cards again",
  "  pinmo logout                        Forget this computer's login",
  "",
  "For an agent organizing a folder into a map:",
  "  1. pinmo login (once; the user allows it in the browser)",
  "  2. pinmo import <folder> --agent-fills   (Pinmo's own model stays off for this import)",
  "  3. pinmo drafts <import-id> <folder>, then look at each draft's photos",
  "  4. pinmo suggest <draft-id> --place \"<shop name>\" for each place you recognize; skip the ones you are unsure of",
  "  5. pinmo status <import-id>, then tell the user which drafts still need a place and give them the review address.",
  "The user checks and confirms every card on the web; nothing is confirmed or shared from here.",
].join("\n");

const LOGIN_MESSAGES = {
  declined: "Login was declined in the browser.",
  state: "The browser's answer was not for this login. Run pinmo login again.",
  timeout: "No answer from the browser within 5 minutes. Run pinmo login again.",
  client: "This Pinmo site does not offer CLI login (agent import is switched off).",
  exchange: "The site did not hand out a token. Run pinmo login again.",
};

const CALLBACK_PAGE = "Pinmo CLI got the answer. You can close this window and go back to the terminal.";

// ---------- small helpers ----------

class Stop extends Error {
  constructor(message, code) {
    super(message);
    this.exitCode = code;
  }
}

const isNull = (value) => value === null || value === undefined || (typeof value.isNil === "function" && value.isNil());

function write(handle, text) {
  handle.writeData($(text + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
const out = (text) => write($.NSFileHandle.fileHandleWithStandardOutput, text);
const err = (text) => write($.NSFileHandle.fileHandleWithStandardError, text);

function env(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
  return isNull(value) ? undefined : value.js;
}

const quote = (text) => "'" + String(text).replace(/'/g, "'\\''") + "'";
const shell = (command) => app.doShellScript(command, { alteringLineEndings: false });

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    text += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    text += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    text += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return text;
}
function base64ToBytes(text) {
  const bytes = [];
  let bits = 0;
  let acc = 0;
  for (const ch of text) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}
const toBase64url = (base64) => base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hexToBytes = (hex) => hex.match(/../g).map((pair) => parseInt(pair, 16));
const dataBytes = (data, at, length) => base64ToBytes(data.subdataWithRange($.NSMakeRange(at, length)).base64EncodedStringWithOptions(0).js);

function randomBase64url(count) {
  return toBase64url(shell("/bin/dd if=/dev/urandom bs=" + count + " count=1 2>/dev/null | /usr/bin/base64").trim());
}

function sha256OfText(text) {
  return shell("/usr/bin/printf %s " + quote(text) + " | /usr/bin/shasum -a 256").split(" ")[0];
}

function sha256OfFile(path) {
  return shell("/usr/bin/shasum -a 256 " + quote(path)).split(" ")[0];
}

function formEncode(fields) {
  return Object.keys(fields)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(fields[key]))
    .join("&");
}

function originOf(text) {
  const url = $.NSURL.URLWithString(text);
  if (isNull(url) || isNull(url.scheme) || isNull(url.host)) throw new Stop(USAGE, 2);
  const port = isNull(url.port) ? "" : ":" + url.port.intValue;
  return url.scheme.js.toLowerCase() + "://" + url.host.js.toLowerCase() + port;
}

// ---------- files ----------

const files = $.NSFileManager.defaultManager;

function readText(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return isNull(text) ? null : text.js;
}

function readJson(path) {
  try {
    const text = readText(path);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return {};
  }
}

function setMode(path, mode) {
  files.setAttributesOfItemAtPathError($({ NSFilePosixPermissions: mode }), path, null);
}

function privateFolder(path) {
  files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $({ NSFilePosixPermissions: 0o700 }), null);
  setMode(path, 0o700);
}

function writePrivate(path, text) {
  $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  setMode(path, 0o600);
}

const configDir = () => (env("XDG_CONFIG_HOME") || $.NSHomeDirectory().js + "/.config") + "/pinmo";
const joinPath = (dir, name) => dir.replace(/\/+$/, "") + "/" + name;

let scratch = null;
function scratchFile(name) {
  if (!scratch) scratch = shell("/usr/bin/mktemp -d -t pinmo").trim();
  return scratch + "/" + name;
}
function cleanUp() {
  if (scratch) shell("/bin/rm -rf " + quote(scratch));
}

function listFolder(dir) {
  const names = files.contentsOfDirectoryAtPathError(dir, null);
  if (isNull(names)) throw new Stop("No such folder: " + dir, 1);
  return ObjC.deepUnwrap(names);
}

function isRegularFile(path) {
  const attrs = files.attributesOfItemAtPathError(path, null);
  return !isNull(attrs) && attrs.objectForKey("NSFileType").js === "NSFileTypeRegular";
}

/** The file's modified time in whole UTC milliseconds, read as text so no precision is lost. */
function modifiedMs(path) {
  const [seconds, fraction = ""] = shell("/usr/bin/stat -f %Fm " + quote(path)).trim().split(".");
  return Number(seconds) * 1000 + Number((fraction + "000").slice(0, 3));
}

// ---------- credentials (same files as the pinmo CLI) ----------

const credentialsPath = () => configDir() + "/credentials.json";
const openImportsPath = () => configDir() + "/open-imports.json";

function saveAll(path, stored) {
  privateFolder(configDir());
  writePrivate(path, JSON.stringify(stored, null, 2) + "\n");
}
const loadCredentials = (origin) => readJson(credentialsPath())[origin] ?? null;
function saveCredentials(creds) {
  const stored = readJson(credentialsPath());
  stored[creds.origin] = creds;
  saveAll(credentialsPath(), stored);
}
function forgetCredentials(origin) {
  const stored = readJson(credentialsPath());
  delete stored[origin];
  saveAll(credentialsPath(), stored);
}
const loadOpenImport = (origin) => readJson(openImportsPath())[origin] ?? null;
function saveOpenImport(origin, importId) {
  const stored = readJson(openImportsPath());
  delete stored[origin];
  if (importId) stored[origin] = importId;
  saveAll(openImportsPath(), stored);
}

// ---------- HTTP ----------

/** One request through curl. Tokens and bodies go through private files, never the command line. */
function http(method, url, { token, json, form, file } = {}) {
  const response = scratchFile("response");
  const parts = ["/usr/bin/curl", "-sS", "-X", method, "-o", quote(response), "-w", quote("%{http_code}")];
  if (token) {
    writePrivate(scratchFile("authorization"), "Authorization: Bearer " + token + "\n");
    parts.push("-H", quote("@" + scratchFile("authorization")));
  }
  if (json !== undefined) {
    writePrivate(scratchFile("body"), JSON.stringify(json));
    parts.push("-H", quote("content-type: application/json"), "--data-binary", quote("@" + scratchFile("body")));
  } else if (form) {
    writePrivate(scratchFile("body"), formEncode(form));
    parts.push("-H", quote("content-type: application/x-www-form-urlencoded"), "--data-binary", quote("@" + scratchFile("body")));
  } else if (file) {
    parts.push("-H", quote("content-type: image/jpeg"), "--data-binary", quote("@" + file));
  } else if (method !== "GET") {
    parts.push("-H", quote("content-type:"), "--data-binary", quote(""));
  }
  parts.push(quote(url));
  files.removeItemAtPathError(response, null);
  let status;
  try {
    status = Number(shell(parts.join(" ")));
  } catch (e) {
    throw new Stop("Could not reach " + url.replace(/^(https?:\/\/[^/]+).*$/, "$1") + ". Check the connection and try again.", 1);
  }
  const text = readText(response) ?? "";
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = null;
  }
  return { status, body };
}

function credentialsFrom(res, origin, clientId) {
  if (res.status < 200 || res.status > 299 || !res.body) return null;
  if (!res.body.access_token || !res.body.refresh_token) return null;
  return {
    origin,
    clientId,
    accessToken: res.body.access_token,
    refreshToken: res.body.refresh_token,
    expiresAt: Date.now() + (res.body.expires_in ?? 0) * 1000,
  };
}

const NEED_LOGIN = "The login has run out or was revoked. Run pinmo login again.";
const TOO_BUSY = "The site is busy. Wait a minute and run the command again.";

/** Calls the agent API like the CLI: a 401 refreshes the token once and retries; rate_limited waits and retries. */
function agentApi(start) {
  let creds = start;
  const resource = creds.origin + AGENT_API_PATH;
  const waitMs = Number(env("PINMO_RETRY_WAIT_MS") || 10000);
  function refresh() {
    const res = http("POST", creds.origin + "/oauth/token", {
      form: { grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: creds.clientId, resource },
    });
    const fresh = credentialsFrom(res, creds.origin, creds.clientId);
    if (!fresh) throw new Stop(NEED_LOGIN, 1);
    creds = fresh;
    saveCredentials(creds);
  }
  return function call(method, path, options = {}) {
    let refreshed = false;
    let retries = 0;
    for (;;) {
      const res = http(method, resource + path, { ...options, token: creds.accessToken });
      if (res.status === 401) {
        if (refreshed) throw new Stop(NEED_LOGIN, 1);
        refresh();
        refreshed = true;
        continue;
      }
      if (res.status === 429 && res.body && res.body.error === "rate_limited") {
        if (retries === MAX_RETRIES) throw new Stop(TOO_BUSY, 1);
        retries += 1;
        delay(waitMs / 1000);
        continue;
      }
      return res;
    }
  };
}

// ---------- login ----------

/** Listens on a free port of 127.0.0.1 and answers every request, keeping the first /callback query. */
function loopback() {
  // sockaddr_in: length 16, AF_INET, port 0 (the system picks one), 127.0.0.1.
  const address = $.NSData.alloc.initWithBase64EncodedStringOptions("EAIAAH8AAAEAAAAAAAAAAA==", 0);
  const socketPort = $.NSSocketPort.alloc.initWithProtocolFamilySocketTypeProtocolAddress(2, 1, 6, address);
  if (isNull(socketPort)) throw new Stop("Could not listen on 127.0.0.1 for the browser's answer.", 1);
  const bound = dataBytes(socketPort.address, 0, 4);
  const port = (bound[2] << 8) | bound[3];
  const listener = $.NSFileHandle.alloc.initWithFileDescriptorCloseOnDealloc(socketPort.socket, false);
  const center = $.NSNotificationCenter.defaultCenter;
  const box = { query: null };
  function reply(connection, status, body) {
    const bytes = $(body).dataUsingEncoding($.NSUTF8StringEncoding);
    const head = "HTTP/1.1 " + status + "\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n\r\n";
    connection.writeData($(head).dataUsingEncoding($.NSUTF8StringEncoding));
    connection.writeData(bytes);
    connection.closeFile;
  }
  ObjC.registerSubclass({
    name: "PinmoLoopback",
    methods: {
      "accepted:": {
        types: ["void", ["id"]],
        implementation: (note) => {
          const connection = note.userInfo.objectForKey($.NSFileHandleNotificationFileHandleItem);
          center.addObserverSelectorNameObject(watcher, "received:", $.NSFileHandleReadCompletionNotification, connection);
          connection.readInBackgroundAndNotify;
          listener.acceptConnectionInBackgroundAndNotify;
        },
      },
      "received:": {
        types: ["void", ["id"]],
        implementation: (note) => {
          const connection = note.object;
          center.removeObserverNameObject(watcher, $.NSFileHandleReadCompletionNotification, connection);
          const data = note.userInfo.objectForKey($.NSFileHandleNotificationDataItem);
          const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
          const line = isNull(text) ? "" : text.js.split("\r\n")[0];
          const match = /^GET \/callback(?:\?([^ ]*))? HTTP\//.exec(line);
          if (!match) return reply(connection, "404 Not Found", "Not found");
          reply(connection, "200 OK", CALLBACK_PAGE);
          if (box.query === null) box.query = match[1] ?? "";
        },
      },
    },
  });
  const watcher = $.PinmoLoopback.alloc.init;
  center.addObserverSelectorNameObject(watcher, "accepted:", $.NSFileHandleConnectionAcceptedNotification, listener);
  listener.acceptConnectionInBackgroundAndNotify;
  return {
    port,
    /** The callback's query parameters, or null when none came before the deadline. */
    wait(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (box.query === null && Date.now() < deadline) {
        $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.2));
      }
      if (box.query === null) return null;
      const params = {};
      for (const pair of box.query.split("&")) {
        if (!pair) continue;
        const [key, value = ""] = pair.split("=");
        params[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(value.replace(/\+/g, " "));
      }
      return params;
    },
    close() {
      center.removeObserver(watcher);
      socketPort.invalidate;
    },
  };
}

function login(origin, openBrowser) {
  const client = http("GET", origin + "/oauth/clients/pinmo-cli");
  const clientId = client.status === 200 && client.body ? client.body.client_id : null;
  if (!clientId) throw new Stop(LOGIN_MESSAGES.client, 1);
  const verifier = randomBase64url(32);
  const state = randomBase64url(24);
  const challenge = toBase64url(bytesToBase64(hexToBytes(sha256OfText(verifier))));
  const callback = loopback();
  const redirectUri = "http://127.0.0.1:" + callback.port + "/callback";
  const resource = origin + AGENT_API_PATH;
  try {
    const query = formEncode({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "photos.import",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    });
    const address = origin + "/oauth/authorize?" + query;
    out("Open this address to let Pinmo CLI import photos into your account:");
    out(address);
    if (openBrowser) shell("/usr/bin/open " + quote(address));
    const answer = callback.wait(Number(env("PINMO_LOGIN_TIMEOUT_MS") || 300000));
    if (!answer) throw new Stop(LOGIN_MESSAGES.timeout, 1);
    if (answer.state !== state) throw new Stop(LOGIN_MESSAGES.state, 1);
    if (!answer.code) throw new Stop(LOGIN_MESSAGES.declined, 1);
    const res = http("POST", origin + "/oauth/token", {
      form: { grant_type: "authorization_code", code: answer.code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource },
    });
    const creds = credentialsFrom(res, origin, clientId);
    if (!creds) throw new Stop(LOGIN_MESSAGES.exchange, 1);
    return creds;
  } finally {
    callback.close();
  }
}

// ---------- photos ----------

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function wallClockMs(value) {
  const m = typeof value === "string" ? EXIF_DATE.exec(value) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function offsetMin(value) {
  const m = typeof value === "string" ? EXIF_OFFSET.exec(value) : null;
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

const deviceOffsetMin = (at) => -at.getTimezoneOffset();

function imageSource(path) {
  const source = $.CGImageSourceCreateWithURL($.NSURL.fileURLWithPath(path), null);
  if (isNull(source) || $.CGImageSourceGetCount(source) < 1) return null;
  return source;
}

function propertiesOf(source) {
  if (!source) return {};
  const props = $.CGImageSourceCopyPropertiesAtIndex(source, 0, null);
  if (isNull(props)) return {};
  return ObjC.deepUnwrap(ObjC.castRefToObject(props)) ?? {};
}

/** Capture time, time zone and GPS, by the web app's rules (src/shared/photo-meta.ts). */
function readMeta(path) {
  const props = propertiesOf(imageSource(path));
  const exif = props["{Exif}"] ?? {};
  const gps = props["{GPS}"] ?? {};
  const where = {};
  if (Number.isFinite(gps.Latitude) && Number.isFinite(gps.Longitude)) {
    where.lat = gps.LatitudeRef === "S" ? -gps.Latitude : gps.Latitude;
    where.lng = gps.LongitudeRef === "W" ? -gps.Longitude : gps.Longitude;
  }
  const wall = wallClockMs(exif.DateTimeOriginal);
  if (wall === null) {
    const lastModified = modifiedMs(path);
    return { takenAt: lastModified, tzOffsetMin: deviceOffsetMin(new Date(lastModified)), takenAtSource: "file_mtime", ...where };
  }
  const offset = offsetMin(exif.OffsetTimeOriginal) ?? deviceOffsetMin(new Date(wall));
  return { takenAt: wall - offset * 60000, tzOffsetMin: offset, takenAtSource: "exif", ...where };
}

/** Drops APP1 (Exif, XMP) and APP13 (IPTC) blocks; the server refuses a copy that still has one. */
function stripMetadata(data) {
  const length = data.length;
  const head = dataBytes(data, 0, 2);
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new Stop("decode", 1);
  const kept = $.NSMutableData.data;
  kept.appendData(data.subdataWithRange($.NSMakeRange(0, 2)));
  let i = 2;
  while (i + 4 <= length) {
    const [mark, marker, hi, lo] = dataBytes(data, i, 4);
    if (mark !== 0xff) break;
    if (marker === 0xda) {
      kept.appendData(data.subdataWithRange($.NSMakeRange(i, length - i)));
      return kept;
    }
    const end = i + 2 + ((hi << 8) | lo);
    if (end > length) break;
    if (marker !== 0xe1 && marker !== 0xed) kept.appendData(data.subdataWithRange($.NSMakeRange(i, end - i)));
    i = end;
  }
  throw new Stop("decode", 1);
}

/** Writes one upright copy, its long edge at most the variant's limit (never larger than the photo), without metadata. */
function makeVariant(path, outPath, variant) {
  const { maxEdge, quality } = VARIANT_LIMITS[variant];
  const source = imageSource(path);
  const props = propertiesOf(source);
  if (!source || !props.PixelWidth || !props.PixelHeight) throw new Stop("decode", 1);
  const options = $({
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: Math.min(maxEdge, Math.max(props.PixelWidth, props.PixelHeight)),
  });
  const image = $.CGImageSourceCreateThumbnailAtIndex(source, 0, options);
  if (isNull(image)) throw new Stop("decode", 1);
  const encoded = $.NSMutableData.data;
  const destination = $.CGImageDestinationCreateWithData(encoded, $("public.jpeg"), 1, null);
  $.CGImageDestinationAddImage(destination, image, $({ kCGImageDestinationLossyCompressionQuality: quality }));
  if (!$.CGImageDestinationFinalize(destination)) throw new Stop("decode", 1);
  if (!stripMetadata(encoded).writeToFileAtomically(outPath, true)) throw new Stop("decode", 1);
}

// ---------- commands ----------

const errorOf = (body) => (body && body.error) || "error";
const JPEG = /\.jpe?g$/i;

function photosIn(dir) {
  const names = listFolder(dir).filter((name) => !name.startsWith(".") && isRegularFile(joinPath(dir, name)));
  const jpegs = names.filter((name) => JPEG.test(name)).sort();
  return { jpegs, others: names.length - jpegs.length };
}

function uploadOne(path, importId, call) {
  const request = { sha256: sha256OfFile(path), ...readMeta(path), importId };
  const created = call("POST", "/photos", { json: request });
  if (created.status !== 200 && created.status !== 201) return { reason: errorOf(created.body) };
  const state = created.body;
  if (state.used) return "saved";
  if (state.missing.length === 0) return "uploaded";
  const made = {};
  try {
    for (const variant of state.missing) {
      made[variant] = scratchFile(variant + ".jpg");
      makeVariant(path, made[variant], variant);
    }
  } catch (e) {
    if (e instanceof Stop) return { reason: "decode" };
    throw e;
  }
  for (const variant of state.missing) {
    const put = call("PUT", "/photos/" + state.photoId + "/" + variant, { file: made[variant] });
    if (put.status !== 200) return { reason: errorOf(put.body) };
  }
  return "uploaded";
}

function formatSummary(report, origin) {
  const lines = [];
  if (report.importId) {
    const { unsupported, saved, failed } = report.skipped;
    lines.push("Uploaded: " + report.uploaded);
    lines.push("Skipped: " + unsupported + " not JPEG (export HEIC as JPEG first), " + saved + " already saved, " + failed.length + " failed");
    for (const failure of failed) lines.push("  " + failure.file + ": " + failure.reason);
  }
  const view = report.view;
  lines.push("Cards: " + view.cards + " (" + view.needPlace + " need a place, " + view.needTime + " need a time)");
  lines.push("Review and confirm: " + origin + "/imports/" + view.id);
  return lines.join("\n");
}

function importFolder(dir, agentFills, call, origin) {
  const { jpegs, others } = photosIn(dir);
  if (jpegs.length === 0) throw new Stop("No JPEG in that folder (HEIC needs exporting as JPEG first).", 1);
  if (jpegs.length > MAX_PHOTOS_PER_IMPORT) throw new Stop("More than 200 JPEGs: split the folder and import each part.", 1);
  const opened = call("POST", "/imports", {
    json: { total: jpegs.length, tzOffsetMin: deviceOffsetMin(new Date()), ...(agentFills ? { agentFills: true } : {}) },
  });
  if (opened.status !== 200 && opened.status !== 201) {
    throw new Stop("The import could not be opened (" + ((opened.body && opened.body.error) || "http_" + opened.status) + ").", 1);
  }
  const importId = opened.body.id;
  if (opened.status === 200 && importId !== loadOpenImport(origin)) {
    throw new Stop("An import is still open on the web. Finish or leave it there first, then import again.", 1);
  }
  if (opened.status === 201) saveOpenImport(origin, importId);
  const report = { importId, uploaded: 0, skipped: { unsupported: others, saved: 0, failed: [] } };
  for (const name of jpegs) {
    const outcome = uploadOne(joinPath(dir, name), importId, call);
    if (outcome === "uploaded") report.uploaded += 1;
    else if (outcome === "saved") report.skipped.saved += 1;
    else report.skipped.failed.push({ file: name, reason: outcome.reason });
  }
  const completed = call("POST", "/imports/" + importId + "/complete");
  if (completed.status === 200) saveOpenImport(origin, null);
  call("POST", "/imports/" + importId + "/auto-cards");
  report.view = call("GET", "/imports/" + importId).body;
  out("Import: " + importId);
  out(formatSummary(report, origin));
}

function listDrafts(importId, dir, call) {
  const listed = call("GET", "/imports/" + encodeURIComponent(importId) + "/drafts");
  if (listed.status !== 200) throw new Stop("No such import.", 1);
  const byHash = {};
  for (const name of listFolder(dir)) {
    if (JPEG.test(name) && !name.startsWith(".")) byHash[sha256OfFile(joinPath(dir, name))] = joinPath(dir, name);
  }
  const lines = [];
  for (const draft of listed.body.drafts) {
    const found = draft.photoSha256s.filter((hash) => byHash[hash]).map((hash) => byHash[hash]);
    const missing = draft.photoSha256s.length - found.length;
    const lacks = [draft.needPlace ? "needs a place" : null, draft.needTime ? "needs a time" : null].filter(Boolean).join(", ") || "ready";
    lines.push(draft.id + "  " + lacks);
    for (const file of found) lines.push("  " + file);
    if (missing) lines.push("  (" + missing + " photo" + (missing === 1 ? "" : "s") + " not in this folder)");
  }
  out(lines.join("\n"));
}

function suggest(draftId, place, tags, call) {
  const body = { placeName: place, ...(tags.length ? { tags } : {}) };
  const res = call("PUT", "/experiences/" + encodeURIComponent(draftId) + "/suggestion", { json: body });
  if (res.status === 400) throw new Stop("The name or tags were not accepted (1–100 characters, up to 3 base tags).", 1);
  if (res.status !== 200) throw new Stop("No such draft in one of your imports.", 1);
  const messages = {
    place: "Prefilled the place for " + draftId + ". The user confirms it on the web.",
    hint: "Kept \"" + place + "\" as a hint for " + draftId + "; no nearby place with that name was found.",
    kept: draftId + " already has a place; left it as it is.",
  };
  out(messages[res.body.result]);
}

function logout(origin) {
  const creds = loadCredentials(origin);
  if (!creds) return out("Not logged in to " + origin + ".");
  http("POST", origin + "/oauth/token", { form: { token: creds.refreshToken, token_type_hint: "refresh_token", client_id: creds.clientId } });
  forgetCredentials(origin);
  out("Logged out of " + origin + ".");
}

function parse(argv) {
  const parsed = { positional: [], origin: DEFAULT_ORIGIN, place: undefined, tags: [], agentFills: false, noBrowser: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--origin") parsed.origin = originOf(argv[++i] ?? "");
    else if (arg === "--place") parsed.place = argv[++i];
    else if (arg === "--tag") parsed.tags.push(argv[++i] ?? "");
    else if (arg === "--agent-fills") parsed.agentFills = true;
    else if (arg === "--no-browser") parsed.noBrowser = true;
    else if (arg === "--help" || arg === "help") parsed.help = true;
    else parsed.positional.push(arg);
  }
  return parsed;
}

function main(argv) {
  const args = parse(argv);
  const [command, first, second, third] = args.positional;
  if (args.help) return out(USAGE);
  if (command === "meta" && first) return out(JSON.stringify({ sha256: sha256OfFile(first), ...readMeta(first) }));
  if (command === "variant" && first && second && VARIANT_LIMITS[third]) return makeVariant(first, second, third);
  if (command === "login") {
    saveCredentials(login(args.origin, !args.noBrowser));
    return out("Logged in to " + args.origin + ".");
  }
  if (command === "logout") return logout(args.origin);
  const needs = { import: first, status: first, drafts: first && second, suggest: first && args.place };
  if (!needs[command]) throw new Stop(USAGE, 2);
  const creds = loadCredentials(args.origin);
  if (!creds) throw new Stop("Not logged in to " + args.origin + ". Run pinmo login first.", 1);
  const call = agentApi(creds);
  if (command === "import") return importFolder(first, args.agentFills, call, args.origin);
  if (command === "drafts") return listDrafts(first, second, call);
  if (command === "suggest") return suggest(first, args.place, args.tags, call);
  const view = call("GET", "/imports/" + encodeURIComponent(first));
  if (view.status !== 200) throw new Stop("No such import.", 1);
  out(formatSummary({ view: view.body }, args.origin));
}

function run(argv) {
  let code = 0;
  try {
    main(argv);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    err(e.message);
    code = e.exitCode;
  } finally {
    cleanUp();
  }
  $.exit(code);
}
```
