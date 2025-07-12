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
  input: string,                          // 元字串(source code)
  pos: number,                            // 當前讀取位置(字元索引)
  lineStart: number,                      // 當前行的起始位置
  curLine: number,                        // 當前是第幾行
  errors: StringContentsErrorHandlers,    // 處理錯誤的函式(例如沒結束的字串)
) {
  // 儲存起始位置
  const initialPos = pos;
  const initialLineStart = lineStart;
  const initialCurLine = curLine;

  let out = ""; // 儲存解析後的字串內容
  let firstInvalidLoc = null; // 記錄第一個無效字元的位置(如轉義錯誤)
  let chunkStart = pos; // 一段未處理文字的起始位置
  const { length } = input; // 優化：提前取出 input 長度

  // 逐字元處理，直到手動 break 為止
  for (; ;) {
    // 超過元字串(原始碼)長度
    if (pos >= length) {
      errors.unterminated(initialPos, initialLineStart, initialCurLine);
      out += input.slice(chunkStart, pos); // 將剩下未處理的部分加進 out
      break;
    }
    // 檢查 ch 是否為字串結尾，則 break 結束
    const ch = input.charCodeAt(pos);
    if (isStringEnd(type, ch, input, pos)) {
      out += input.slice(chunkStart, pos); // 將最後一段加入 out
      break; // 字串結束，跳出迴圈
    }

    // 檢查 ch 是否為「反斜線」，如果是，則讀取轉義字元
    // (如 \n, \u1234 等)
    if (ch === charCodes.backslash) {
      // 先把反斜線之前的內容加入 out
      out += input.slice(chunkStart, pos);
      const res = readEscapedChar(
        input,
        pos,
        lineStart,
        curLine,
        type === "template",
        errors,
      );

      // 若轉義字元為 null，代表非法轉義，記錄第一次出錯的位置
      if (res.ch === null && !firstInvalidLoc) {
        firstInvalidLoc = { pos, lineStart, curLine };
      } else {
        // 將轉義後的內容加到 out 中
        out += res.ch;
      }

      // 解構賦值：更新目前讀取位置與行資訊(readEscapedChar 已經幫忙處理完)
      ({ pos, lineStart, curLine } = res);

      chunkStart = pos; // 下一段未處理字串的起始點
    } else if (
      // 處理 Unicode 特殊換行符號
      ch === charCodes.lineSeparator /*\u2028*/ ||
      ch === charCodes.paragraphSeparator /*\u2029*/
    ) {
      ++pos; // 移動到下一個字元
      ++curLine; // 行數 +1
      lineStart = pos; // 新的一行起始位置更新
    } else if (
      // 處理一般換行字元(\n 或 \r)
      ch === charCodes.lineFeed ||
      ch === charCodes.carriageReturn
    ) {
      // 如果是模板字串，是可以換行的，因此換行後需要加上換行符號
      if (type === "template") {
        out += input.slice(chunkStart, pos) + "\n"; // 模板字串會保留換行
        ++pos;

        // 處理 CRLF 的情況（\r\n）：跳過第二個字元 \n
        if (
          ch === charCodes.carriageReturn &&
          input.charCodeAt(pos) === charCodes.lineFeed
        ) {
          ++pos;
        }

        ++curLine; // 換行後，更新行資訊
        chunkStart = lineStart = pos; // 下一段字串解析的起始位置
      } else {
        // 單引號、雙引號的字串，不允許換行
        errors.unterminated(initialPos, initialLineStart, initialCurLine);
      }
    } else {
      // 一般 char 則繼續往後移動 pos
      ++pos;
    }
  }

  // 根據環境變數決定回傳的格式（Babel 8 才會啟用 breaking 改動）
  return process.env.BABEL_8_BREAKING
    ? {
      pos,              // 目前讀取位置
      str: out,         // 解析後的字串內容
      firstInvalidLoc,  // 第一個錯誤位置（若有）
      lineStart,        // 當前行的起始位置
      curLine,          // 當前行號
    }
    : {
      pos,
      str: out,
      firstInvalidLoc,
      lineStart,
      curLine,
      containsInvalid: !!firstInvalidLoc, // 是否包含錯誤（布林值）
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
      /* 
        - 如果 ch 是「$」且 下一個 ch 是「{」
        - 當遇到「${」，readStringContents() 結束當前的字串讀取，把 ${ 當成 "字串中斷點"，然後：
        👉 Babel 的 parser 會跳出去處理 ${...} 裡面的 JS 表達式，等到 「}」 結束後，再重新進入 readStringContents()，繼續讀取後半段的模板字串。
          - 讀到 ${ 或 ` 為止，分段產生不同的 tokens ->  templateHead / Middle / Tail
      */
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
  input: string,                    // 輸入的字串，包含轉義字元
  pos: number,                      // 目前解析的位置（index）
  lineStart: number,                // 當前行的起始位置（index）
  curLine: number,                  // 當前行數
  inTemplate: boolean,              // 是否在模板字串中（template literal）
  errors: EscapedCharErrorHandlers, // 錯誤處理物件，負責報錯
) {
  // 非模板字串時，遇到非法轉義字元要報錯
  const throwOnInvalid = !inTemplate;

  pos++; // 跳過 '\'，進入轉義字元的下一個字元

  const res = (ch: string | null) => ({ pos, ch, lineStart, curLine });

  // 取得下一個字元的 ASCII code，並把位置往後移
  const ch = input.charCodeAt(pos++);
  switch (ch) {
    case charCodes.lowercaseN:  // '\n' 轉換成換行符號
      return res("\n");

    case charCodes.lowercaseR:  // '\r' 轉換成回車符號
      return res("\r");

    // '\x' 代表讀取兩個十六進位字元，轉成對應的字元
    case charCodes.lowercaseX: {
      let code;
      ({ code, pos } = readHexChar(
        input,
        pos,
        lineStart,
        curLine,
        2,              // 讀兩個十六進位字元
        false,
        throwOnInvalid,
        errors,
      ));
      // 如果解析失敗回傳 null，成功就轉換成字元
      return res(code === null ? null : String.fromCharCode(code));
    }

    // '\u' 讀取 Unicode code point (可能是多個字元組成)
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
      // 解析失敗回傳 null，成功轉換成對應字元
      return res(code === null ? null : String.fromCodePoint(code));
    }

    case charCodes.lowercaseT:  // '\t' 轉成 tab 字元
      return res("\t");
    case charCodes.lowercaseB:  // '\b' 退格字元
      return res("\b");
    case charCodes.lowercaseV:  // '\v' 垂直制表符
      return res("\u000b");
    case charCodes.lowercaseF:  // '\f' 換頁字元
      return res("\f");

    case charCodes.carriageReturn:  // 遇到回車字元時，如果下一字元是換行，pos 往後多跳一格
      if (input.charCodeAt(pos) === charCodes.lineFeed) {
        ++pos;
      }
    // fall through

    case charCodes.lineFeed:  // 遇到換行字元，更新行起始位置和行數
      lineStart = pos;
      ++curLine;
    // fall through

    case charCodes.lineSeparator:
    case charCodes.paragraphSeparator:  // 這些特殊的換行字元轉換成空字串
      return res("");

    case charCodes.digit8:
    case charCodes.digit9:  // 八、九不是合法的八進位字元
      if (inTemplate) {
        // 如果是模板字串中，回傳 null 表示非法轉義
        return res(null);
      } else {
        // 非模板字串中直接報錯（嚴格模式）
        errors.strictNumericEscape(pos - 1, lineStart, curLine);
      }
    // fall through

    default:
      // 預設情況下，判斷是否是合法的八進位字元（0~7）
      if (ch >= charCodes.digit0 && ch <= charCodes.digit7) {
        // 取得八進位轉義字串起點
        const startPos = pos - 1;

        // 用正規表達式擷取最多三個八進位字元（0~7）
        const match = /^[0-7]+/.exec(input.slice(startPos, pos + 2));

        // 取出 octal 字串，解析成十進位數值
        let octalStr = match[0];
        let octal = parseInt(octalStr, 8);

        // 如果超過 255（超過 byte 範圍），去掉最後一個字元重新解析
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }

        // 調整位置指標，跳過整個八進位字串長度
        pos += octalStr.length - 1;

        // 取得下一個字元（即 pos 指向的字元）
        const next = input.charCodeAt(pos);

        // 判斷是否有非法八進位後綴
        if (
          octalStr !== "0" ||      // 八進位不是純0
          next === charCodes.digit8 ||
          next === charCodes.digit9 // 八進位後面不能接 8 或 9
        ) {
          if (inTemplate) {
            return res(null);
          } else {
            errors.strictNumericEscape(startPos, lineStart, curLine);
          }
        }

        return res(String.fromCharCode(octal));
      }

      // 以上都不符合，直接把字元轉成字串回傳（一般字元）
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
