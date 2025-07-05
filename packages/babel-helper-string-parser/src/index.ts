// We inline this package
// eslint-disable-next-line import/no-extraneous-dependencies
import * as charCodes from "charcodes";

// The following character codes are forbidden from being
// an immediate sibling of NumericLiteralSeparator _
const forbiddenNumericSeparatorSiblings = {
  decBinOct: new Set<number>([
    charCodes.dot,
    charCodes.uppercaseB,
    charCodes.uppercaseE,
    charCodes.uppercaseO,
    charCodes.underscore, // multiple separators are not allowed
    charCodes.lowercaseB,
    charCodes.lowercaseE,
    charCodes.lowercaseO,
  ]),
  hex: new Set<number>([
    charCodes.dot,
    charCodes.uppercaseX,
    charCodes.underscore, // multiple separators are not allowed
    charCodes.lowercaseX,
  ]),
};

const isAllowedNumericSeparatorSibling = {
  // 0 - 1
  bin: (ch: number) => ch === charCodes.digit0 || ch === charCodes.digit1,

  // 0 - 7
  oct: (ch: number) => ch >= charCodes.digit0 && ch <= charCodes.digit7,

  // 0 - 9
  dec: (ch: number) => ch >= charCodes.digit0 && ch <= charCodes.digit9,

  // 0 - 9, A - F, a - f,
  hex: (ch: number) =>
    (ch >= charCodes.digit0 && ch <= charCodes.digit9) ||
    (ch >= charCodes.uppercaseA && ch <= charCodes.uppercaseF) ||
    (ch >= charCodes.lowercaseA && ch <= charCodes.lowercaseF),
};

export type StringContentsErrorHandlers = EscapedCharErrorHandlers & {
  unterminated(
    initialPos: number,
    initialLineStart: number,
    initialCurLine: number,
  ): void;
};

export function readStringContents(
  type: "single" | "double" | "template", // 單引號、雙引號、模板字串
  input: string,
  pos: number,
  lineStart: number,
  curLine: number,
  errors: StringContentsErrorHandlers,
) {
  // 儲存起始位置
  const initialPos = pos;
  const initialLineStart = lineStart;
  const initialCurLine = curLine;

  let out = ""; // 儲存解析後的字串內容
  let firstInvalidLoc = null; // 儲存第一個無效字元的位置
  let chunkStart = pos; // 儲存當前字串片段的起始位置
  const { length } = input;

  for (;;) {
    // 超過元字串(原始碼)長度
    if (pos >= length) {
      errors.unterminated(initialPos, initialLineStart, initialCurLine);
      out += input.slice(chunkStart, pos);
      break;
    }
    // 檢查 ch 是否為字串結尾，則 break 結束
    const ch = input.charCodeAt(pos);
    if (isStringEnd(type, ch, input, pos)) {
      out += input.slice(chunkStart, pos);
      break;
    }
    // 檢查 ch 是否為「反斜線」，如果是，則讀取轉義字元
    if (ch === charCodes.backslash) {
      out += input.slice(chunkStart, pos);
      const res = readEscapedChar(
        input,
        pos,
        lineStart,
        curLine,
        type === "template",
        errors,
      );
      if (res.ch === null && !firstInvalidLoc) {
        firstInvalidLoc = { pos, lineStart, curLine };
      } else {
        out += res.ch;
      }
      ({ pos, lineStart, curLine } = res);
      chunkStart = pos;
    } else if (
      ch === charCodes.lineSeparator ||
      ch === charCodes.paragraphSeparator
    ) {
      ++pos;
      ++curLine;
      lineStart = pos;
    } else if (ch === charCodes.lineFeed || ch === charCodes.carriageReturn) {
      if (type === "template") {
        out += input.slice(chunkStart, pos) + "\n";
        ++pos;
        if (
          ch === charCodes.carriageReturn &&
          input.charCodeAt(pos) === charCodes.lineFeed
        ) {
          ++pos;
        }
        ++curLine;
        chunkStart = lineStart = pos;
      } else {
        errors.unterminated(initialPos, initialLineStart, initialCurLine);
      }
    } else {
      ++pos;
    }
  }
  return process.env.BABEL_8_BREAKING
    ? { pos, str: out, firstInvalidLoc, lineStart, curLine }
    : {
        pos,
        str: out,
        firstInvalidLoc,
        lineStart,
        curLine,
        containsInvalid: !!firstInvalidLoc,
      };
}

function isStringEnd(
  type: "single" | "double" | "template",
  ch: number,
  input: string,
  pos: number,
) {
  // 模板字符串
  if (type === "template") {
    return (
      /* 如果 ch 是 '`' */ 
      ch === charCodes.graveAccent ||
      /* 如果 ch 是 '$' 且 下一個 ch 是 '{' */
      (ch === charCodes.dollarSign &&
        input.charCodeAt(pos + 1) === charCodes.leftCurlyBrace)
    );
  }
    // 如果 ch 是否為「單引號」或「雙引號」
  return (
    ch === (type === "double" ? charCodes.quotationMark : charCodes.apostrophe)
  );
}

type EscapedCharErrorHandlers = HexCharErrorHandlers &
  CodePointErrorHandlers & {
    strictNumericEscape(pos: number, lineStart: number, curLine: number): void;
  };

function readEscapedChar(
  input: string,
  pos: number,
  lineStart: number,
  curLine: number,
  inTemplate: boolean,
  errors: EscapedCharErrorHandlers,
) {
  // 如果非模板字符串，當不合法時需要報錯
  const throwOnInvalid = !inTemplate;
  pos++; // skip '\'

  const res = (ch: string | null) => ({ pos, ch, lineStart, curLine });

  const ch = input.charCodeAt(pos++);
  switch (ch) {
    case charCodes.lowercaseN:
      return res("\n");
    case charCodes.lowercaseR:
      return res("\r");
    // 如果 ch 是 'x'，則讀取兩個十六進位字元
    case charCodes.lowercaseX: {
      let code;
      ({ code, pos } = readHexChar(
        input,
        pos,
        lineStart,
        curLine,
        2,
        false,
        throwOnInvalid,
        errors,
      ));
      return res(code === null ? null : String.fromCharCode(code));
    }
    case charCodes.lowercaseU: {
      let code;
      ({ code, pos } = readCodePoint(
        input,
        pos,
        lineStart,
        curLine,
        throwOnInvalid,
        errors,
      ));
      return res(code === null ? null : String.fromCodePoint(code));
    }
    case charCodes.lowercaseT:
      return res("\t");
    case charCodes.lowercaseB:
      return res("\b");
    case charCodes.lowercaseV:
      return res("\u000b");
    case charCodes.lowercaseF:
      return res("\f");
    case charCodes.carriageReturn:
      if (input.charCodeAt(pos) === charCodes.lineFeed) {
        ++pos;
      }
    // fall through
    case charCodes.lineFeed:
      lineStart = pos;
      ++curLine;
    // fall through
    case charCodes.lineSeparator:
    case charCodes.paragraphSeparator:
      return res("");
    case charCodes.digit8:
    case charCodes.digit9:
      if (inTemplate) {
        return res(null);
      } else {
        errors.strictNumericEscape(pos - 1, lineStart, curLine);
      }
    // fall through
    default:
      if (ch >= charCodes.digit0 && ch <= charCodes.digit7) {
        const startPos = pos - 1;
        const match = /^[0-7]+/.exec(input.slice(startPos, pos + 2));

        let octalStr = match[0];

        let octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        pos += octalStr.length - 1;
        const next = input.charCodeAt(pos);
        if (
          octalStr !== "0" ||
          next === charCodes.digit8 ||
          next === charCodes.digit9
        ) {
          if (inTemplate) {
            return res(null);
          } else {
            errors.strictNumericEscape(startPos, lineStart, curLine);
          }
        }

        return res(String.fromCharCode(octal));
      }

      return res(String.fromCharCode(ch));
  }
}

type HexCharErrorHandlers = IntErrorHandlers & {
  invalidEscapeSequence(pos: number, lineStart: number, curLine: number): void;
};

// Used to read character escape sequences ('\x', '\u').
function readHexChar(
  input: string,
  pos: number,
  lineStart: number,
  curLine: number,
  len: number,
  forceLen: boolean,
  throwOnInvalid: boolean,
  errors: HexCharErrorHandlers,
) {
  const initialPos = pos;
  let n;
  ({ n, pos } = readInt(
    input,
    pos,
    lineStart,
    curLine,
    16,
    len,
    forceLen,
    false,
    errors,
    /* bailOnError */ !throwOnInvalid,
  ));
  if (n === null) {
    if (throwOnInvalid) {
      errors.invalidEscapeSequence(initialPos, lineStart, curLine);
    } else {
      pos = initialPos - 1;
    }
  }
  return { code: n, pos };
}

export type IntErrorHandlers = {
  numericSeparatorInEscapeSequence(
    pos: number,
    lineStart: number,
    curLine: number,
  ): void;
  unexpectedNumericSeparator(
    pos: number,
    lineStart: number,
    curLine: number,
  ): void;
  // It can return "true" to indicate that the error was handled
  // and the int parsing should continue.
  invalidDigit(
    pos: number,
    lineStart: number,
    curLine: number,
    radix: number,
  ): boolean;
};

export function readInt(
  input: string,
  pos: number,
  lineStart: number,
  curLine: number,
  radix: number,
  len: number | undefined,
  forceLen: boolean,
  allowNumSeparator: boolean | "bail",
  errors: IntErrorHandlers,
  bailOnError: boolean,
) {
  const start = pos;
  // 根據 radix 的不同，numberic seprator(即「_」) 後方有不同的禁止字元是不被允許的
  const forbiddenSiblings =
    radix === 16
      ? forbiddenNumericSeparatorSiblings.hex
      : forbiddenNumericSeparatorSiblings.decBinOct;
  // 跟上相反，根據 radix 的不同，numberic seprator(即「_」) 後方有不同的字元是被允許的
  const isAllowedSibling =
    radix === 16
      ? isAllowedNumericSeparatorSibling.hex
      : radix === 10
        ? isAllowedNumericSeparatorSibling.dec
        : radix === 8
          ? isAllowedNumericSeparatorSibling.oct
          : isAllowedNumericSeparatorSibling.bin;

  let invalid = false;
  let total = 0;

  for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
    const code = input.charCodeAt(pos);
    let val;

    // 當前 ch 是 numberic seprator(即 underscore)，且 allowNumSeparator 不為 "bail"
    if (code === charCodes.underscore && allowNumSeparator !== "bail") {
      const prev = input.charCodeAt(pos - 1);
      const next = input.charCodeAt(pos + 1);

      if (!allowNumSeparator) {
        if (bailOnError) return { n: null, pos };
        errors.numericSeparatorInEscapeSequence(pos, lineStart, curLine);
      } else if (
        Number.isNaN(next) ||
        !isAllowedSibling(next) ||
        forbiddenSiblings.has(prev) ||
        forbiddenSiblings.has(next)
      ) {
        if (bailOnError) return { n: null, pos };
        errors.unexpectedNumericSeparator(pos, lineStart, curLine);
      }

      // Ignore this _ character
      ++pos;
      continue;
    }

    if (code >= charCodes.lowercaseA) {
      val = code - charCodes.lowercaseA + charCodes.lineFeed;
    } else if (code >= charCodes.uppercaseA) {
      val = code - charCodes.uppercaseA + charCodes.lineFeed;
    } else if (charCodes.isDigit(code)) {
      val = code - charCodes.digit0; // 0-9
    } else {
      val = Infinity;
    }
    if (val >= radix) {
      // If we found a digit which is too big, errors.invalidDigit can return true to avoid
      // breaking the loop (this is used for error recovery).
      if (val <= 9 && bailOnError) {
        return { n: null, pos };
      } else if (
        val <= 9 &&
        errors.invalidDigit(pos, lineStart, curLine, radix)
      ) {
        val = 0;
      } else if (forceLen) {
        val = 0;
        invalid = true;
      } else {
        break;
      }
    }
    ++pos;
    total = total * radix + val;
  }
  if (pos === start || (len != null && pos - start !== len) || invalid) {
    return { n: null, pos };
  }

  return { n: total, pos };
}

export type CodePointErrorHandlers = HexCharErrorHandlers & {
  invalidCodePoint(pos: number, lineStart: number, curLine: number): void;
};

export function readCodePoint(
  input: string,
  pos: number,
  lineStart: number,
  curLine: number,
  throwOnInvalid: boolean,
  errors: CodePointErrorHandlers,
) {
  const ch = input.charCodeAt(pos);
  let code;

  if (ch === charCodes.leftCurlyBrace) {
    ++pos;
    ({ code, pos } = readHexChar(
      input,
      pos,
      lineStart,
      curLine,
      input.indexOf("}", pos) - pos,
      true,
      throwOnInvalid,
      errors,
    ));
    ++pos;
    if (code !== null && code > 0x10ffff) {
      if (throwOnInvalid) {
        errors.invalidCodePoint(pos, lineStart, curLine);
      } else {
        return { code: null, pos };
      }
    }
  } else {
    ({ code, pos } = readHexChar(
      input,
      pos,
      lineStart,
      curLine,
      4,
      false,
      throwOnInvalid,
      errors,
    ));
  }
  return { code, pos };
}
