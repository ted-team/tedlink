"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function createTarGzArchive(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("missing --fpath input");
  }
  const entries = [];
  const seen = new Set();
  for (const inputPath of inputPaths) {
    const sourceInput = String(inputPath || "").trim();
    if (!sourceInput) {
      throw new Error("invalid empty --fpath input");
    }
    const sourcePath = path.resolve(sourceInput);
    const topLevelName = path.basename(sourcePath);
    if (!topLevelName) {
      throw new Error(`invalid --fpath input: ${inputPath}`);
    }
    collectArchiveEntries(sourcePath, topLevelName, entries, seen);
  }
  return zlib.gzipSync(createTarArchive(entries));
}

function collectArchiveEntries(sourcePath, archivePath, entries, seen) {
  let stat;
  try {
    stat = fs.lstatSync(sourcePath);
  } catch {
    throw new Error(`--fpath input does not exist: ${sourcePath}`);
  }
  const normalizedArchivePath = normalizeArchivePath(archivePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`--fpath cannot include symlink: ${sourcePath}`);
  }
  if (stat.isDirectory()) {
    const dirPath = `${normalizedArchivePath.replace(/\/+$/g, "")}/`;
    pushEntry(entries, seen, {
      path: dirPath,
      type: "directory",
      mode: 0o755,
      mtime: stat.mtime,
      content: Buffer.alloc(0),
    });
    const children = fs.readdirSync(sourcePath, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    for (const childName of children) {
      collectArchiveEntries(
        path.join(sourcePath, childName),
        `${dirPath}${childName}`,
        entries,
        seen,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`--fpath can only include files and directories: ${sourcePath}`);
  }
  pushEntry(entries, seen, {
    path: normalizedArchivePath,
    type: "file",
    mode: 0o644,
    mtime: stat.mtime,
    content: fs.readFileSync(sourcePath),
  });
}

function pushEntry(entries, seen, entry) {
  if (seen.has(entry.path)) {
    throw new Error(`duplicate archive path from --fpath inputs: ${entry.path}`);
  }
  seen.add(entry.path);
  entries.push(entry);
}

function normalizeArchivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".." || part.includes(":"))) {
    throw new Error(`unsafe --fpath archive path: ${value}`);
  }
  return parts.join("/");
}

function createTarArchive(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content || Buffer.alloc(0));
    parts.push(tarHeader(entry, content.length), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) {
      parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function tarHeader(entry, size) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(entry.path);
  writeString(header, name, 0, 100);
  writeString(header, octal(entry.mode, 8), 100, 8);
  writeString(header, octal(0, 8), 108, 8);
  writeString(header, octal(0, 8), 116, 8);
  writeString(header, octal(size, 12), 124, 12);
  writeString(header, octal(Math.floor(entry.mtime.getTime() / 1000), 12), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = entry.type === "directory" ? 0x35 : 0x30;
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, prefix, 345, 155);
  writeString(header, checksum(header), 148, 8);
  return header;
}

function splitTarPath(filePath) {
  const bytes = Buffer.byteLength(filePath);
  if (bytes <= 100) {
    return { name: filePath, prefix: "" };
  }
  const parts = filePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`--fpath archive path is too long for tar format: ${filePath}`);
}

function octal(value, width) {
  const text = Math.max(0, Number(value) || 0).toString(8);
  if (text.length > width - 1) {
    throw new Error(`tar header value is too large: ${value}`);
  }
  return `${text.padStart(width - 1, "0")}\0`;
}

function checksum(header) {
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  const text = sum.toString(8);
  if (text.length > 6) {
    throw new Error(`tar checksum is too large: ${sum}`);
  }
  return `${text.padStart(6, "0")}\0 `;
}

function writeString(buffer, value, offset, length) {
  Buffer.from(String(value || "")).copy(buffer, offset, 0, length);
}

module.exports = {
  createTarGzArchive,
  createTarArchive,
};
