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

/*
  針對以下回傳的 pos ，稍微記錄一下，
  
  在 Babel 的 read* 類解析函式中，回傳的 pos 幾乎一律是指向「下一個要處理的字元」的位置，也就是目前處理完的字元「之後」的位置。

  🔍 為什麼會這樣設計？ 這種設計有幾個好處：
  
  1. 符合迭代解析邏輯，解析器會一直向右移動掃描字串，所以：
     ```ts
       let { ch, pos } = readSomething(input, pos);
       下一次呼叫時會直接使用新的 pos 繼續處理下個 token，不需要額外處理偏移：
     ```

     ```ts
       readNextThing(input, pos); // 直接從上次結束的地方開始
     ```

  2. 避免重複處理已解析字元
     如果回傳的是當前字元的位置，那你下一輪解析時還要自己做 pos + 1，容易漏寫或錯誤。
  
  3. 保持語意一致性
     整個 Babel token parser 都採用這種「游標指向下一個字元」的模式，像指標一樣移動。
*/

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
  input: string,                // 輸入原始字串
  pos: number,                  // 當前讀取位置
  lineStart: number,            // 該行的起始位置
  curLine: number,              // 當前行號
  len: number,                  // 要讀幾個十六進位數字（ex: 2 for \x, 4 or variable for \u）
  forceLen: boolean,            // 是否強制要求固定長度（true 時長度不足就是錯）
  throwOnInvalid: boolean,      // 遇到錯誤是否要直接拋出錯誤
  errors: HexCharErrorHandlers, // 錯誤處理器（提供報錯用函式）
) {
  const initialPos = pos; // 記錄原始位置（用來在錯誤時回溯）

  let n;
  ({ n, pos } = readInt(
    input,
    pos,
    lineStart,
    curLine,
    16,                                 // 基底為 16（十六進位）
    len,                                // 要讀取的長度
    forceLen,                           // 是否一定要滿足長度
    false,                              // allowSeparators（是否允許數字中有下底線 separator），這邊 false 表示不允許
    errors,
    /* bailOnError */ !throwOnInvalid, // 是否在錯誤時停止繼續處理（通常模板字串裡比較寬容）
  ));

  // 如果 n 為 null，表示讀取失敗（可能是長度不足或遇到非法字元）
  if (n === null) {
    if (throwOnInvalid) {
      errors.invalidEscapeSequence(initialPos, lineStart, curLine);
    } else {
      // 否則回退至初始位置上一格，讓上層 fallback 處理
      pos = initialPos - 1;
    }
  }

  // 回傳結果：解析出的字符*數值*(即 charcode)、當前位置
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
  input: string,                       // 輸入字串
  pos: number,                         // 當前游標位置
  lineStart: number,                   // 行起始位置（錯誤定位用）
  curLine: number,                     // 行號（錯誤定位用）
  radix: number,                       // 進位（如 16、10、8、2）
  len: number | undefined,             // 最多讀幾個字元（undefined 代表無限）
  forceLen: boolean,                   // 若 true，長度不符合時要報錯（例如 \x 要 2 位十六進制的數字）
  allowNumSeparator: boolean | "bail", // 是否允許 `_` 分隔數字（如 1_000）
  errors: IntErrorHandlers,            // 錯誤處理 callback（例如 invalidDigit）
  bailOnError: boolean,                // 出錯是否直接返回（用於模板字串之類容錯場景）
) {
  // 紀錄開始位置，用於檢查是否成功解析任何數字
  const start = pos;

  // 根據 radix 的不同，決定哪些字元不能跟 numeric separator(即「_」) 相鄰
  const forbiddenSiblings =
    radix === 16
      ? forbiddenNumericSeparatorSiblings.hex
      : forbiddenNumericSeparatorSiblings.decBinOct;

  // 跟上相反，根據 radix 的不同，哪些字元是被允許作為 numeric separator(即「_」) 後的合法字元
  const isAllowedSibling =
    radix === 16
      ? isAllowedNumericSeparatorSibling.hex
      : radix === 10
        ? isAllowedNumericSeparatorSibling.dec
        : radix === 8
          ? isAllowedNumericSeparatorSibling.oct
          : isAllowedNumericSeparatorSibling.bin;

  let invalid = false; // 用來標記解析過程中是否遇到非法值
  let total = 0;       // 最後解析出來的整數

  // 主要解析迴圈：每次處理一個字元
  for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
    // 讀當前字元的 charCode
    const code = input.charCodeAt(pos);
    let val;

    // 當前 ch 是 numeric separator(即 underscore)，且 allowNumSeparator 不為 "bail"
    if (code === charCodes.underscore && allowNumSeparator !== "bail") {
      const prev = input.charCodeAt(pos - 1);
      const next = input.charCodeAt(pos + 1);

      // 不允許「_」，直接報錯或中止
      if (!allowNumSeparator) {
        if (bailOnError) return { n: null, pos };
        errors.numericSeparatorInEscapeSequence(pos, lineStart, curLine);
      } else if (
        // 允許使用「_」，但位置錯誤（前後包含非法字元），仍報錯
        Number.isNaN(next) ||
        !isAllowedSibling(next) ||
        forbiddenSiblings.has(prev) ||
        forbiddenSiblings.has(next)
      ) {
        if (bailOnError) return { n: null, pos };
        errors.unexpectedNumericSeparator(pos, lineStart, curLine);
      }

      ++pos; // 跳過「_」
      continue; // 不將「_」納入計算
    }

    // 判斷當前字元是否是合法的進位數字，並將其轉換為對應的數值
    // 這裡的 val 是把字元的 charCode 轉成整數，例如：'0' → 0, 'A' → 10, 'F' → 15
    /*
     * 十六進位以上的進位系統（例如 base-16, base-36）會使用字母來表示數字：
     *   - 'a' 和 'A' 都對應到 10，'f' 對應 15，'z' 對應 35
     * 
     * 為了達到這個效果，這裡使用公式：「code - 起始點 + 數值基底」
     *   - 若 code 是 'a' (97)：
     *      val = 97 - 97(起始點) + 10(基底數值) = 10
     *   - 若 code 是 'A' (65)：
     *      val = 65 - 65(起始點) + 10(基底數值) = 10
     * 
     * 這裡的 10 實際上是用 charCodes.lineFeed（即 '\n' 的 Unicode 值，剛好是 10）
     * 純粹是為了避免直接寫魔術數字 10
     */
    if (code >= charCodes.lowercaseA) { // 小寫英文字母 a ~ z
      val = code - charCodes.lowercaseA + charCodes.lineFeed;
    } else if (code >= charCodes.uppercaseA) { // 大寫英文字母 A ~ Z
      val = code - charCodes.uppercaseA + charCodes.lineFeed;
    } else if (charCodes.isDigit(code)) { // 數字字元 '0' ~ '9'
      val = code - charCodes.digit0; // 0 ~ 9
    } else {
      // 非合法字元（非數字或英文字母），例如 '!', '@'，設為 Infinity，代表無效字元，
      // Infinity 會在下一段 if (val >= radix) 中被偵測，進而判定該字元不是合法數字。
      val = Infinity;
    }

    // 上面解析出真正的數字後，處理超出 radix 的錯誤數字
    // 例如：如果轉換出來的數值已經超過 radix（如 radix = 16，val > 15），表示該字元 不是合法數字。
    if (val >= radix) {
      // If we found a digit which is too big, errors.invalidDigit can return true to avoid
      // breaking the loop (this is used for error recovery).
      if (val <= 9 && bailOnError) {
        // 如果是數字 0-9，但超過 radix，且允許 bailOnError，直接返回 null
        return { n: null, pos };
      } else if (
        val <= 9 &&
        errors.invalidDigit(pos, lineStart, curLine, radix)
      ) {
        // 如果是數字 0-9，但超過 radix，且錯誤處理器回傳 true，則將 val 設為 0（作為一種復原策略）
        val = 0;
      } else if (forceLen) {
        // 若啟用 forceLen（如 \xXX、\uXXXX），必須讀滿固定長度，即使遇到非法字元也不能跳出；
        // 這裡設為 0 並標記錯誤(invalid = true)，延後處理錯誤
        val = 0;
        invalid = true;
      } else {
        // 如果不強制長度，也不容錯，那就停止解析，直接回傳目前累積的數值。
        // 不往下繼續累積數值
        break;
      }
    }

    ++pos; // 移動到下一個字元位置

    // Standard radix-based parsing: shift left (multiply by radix), then add current digit.
    // For example: "0x1F" → ((0 * 16 + 1) * 16 + 15) = 31
    total = total * radix + val;
    /*
      🧠 背後原理：進位制的乘加法解析（乘法展開）
    
      這是一種標準的數字解析技巧，用來將字元逐位解析成整數。
    
      ✅ 通用公式： total = total * radix + 當前位數值
    
      📌 每進一位，就相當於左移一位（乘上一個 radix 的位權），再加上目前解析到的值。
    
      以十六進位為例：解析 "0x1F"（= 31）
    
      字元順序 | val | total（計算過程）
      ---------|-----|-------------------
      '1'      | 1   | total = 0 * 16 + 1 = 1
      'F'      | 15  | total = 1 * 16 + 15 = 31
    
      也適用於二進位、八進位、十進位等任意進位制，例如：
    
      - "0b101"（二進位）→ 1×2² + 0×2¹ + 1×2⁰ = 5
      - "075"（八進位）  → 7×8¹ + 5×8⁰ = 61
      - "123"（十進位）  → 1×10² + 2×10¹ + 3×10⁰ = 123
    
      ❗ 注意：此演算法會受到 radix 與位數影響，數值過大可能導致溢位（但 parser 通常不考慮這點）。
      
      ❗ 雖然此處不檢查 overflow，但在某些語言（如 C/C++）中，過大值可能導致錯誤。
      Babel 這邊僅作 parser，因此允許解析極大整數，後續會由 AST consumer 處理語義層級問題。
    */
  }

  if (pos === start || (len != null && pos - start !== len) || invalid) {
    return { n: null, pos }; // 解析失敗
  }

  return { n: total, pos }; // 回傳成功解析的整數與當前位置
}

export type CodePointErrorHandlers = HexCharErrorHandlers & {
  invalidCodePoint(pos: number, lineStart: number, curLine: number): void;
};

export function readCodePoint(
  input: string,                  // 要解析的原始輸入字串
  pos: number,                    // 當前掃描位置
  lineStart: number,              // 當前行的起始位置
  curLine: number,                // 當前行號
  throwOnInvalid: boolean,        // 是否遇錯拋出錯誤
  errors: CodePointErrorHandlers, // 錯誤處理器（傳入報錯函式）
) {
  const ch = input.charCodeAt(pos); // 讀當前字元的 charCode（數字表示）
  let code;                         // 儲存解析出來的 Unicode code point

  if (ch === charCodes.leftCurlyBrace) { // 如果是 '{'（處理 \u{XXXX} 格式，動態長度）
    ++pos; // 跳過左大括號「{」

    ({ code, pos } = readHexChar(
      input,
      pos,
      lineStart,
      curLine,
      input.indexOf("}", pos) - pos, // 動態計算要讀幾個字元（從當前位置直到 '}'）
      true,                          // 是否要強制指定長度（否則報錯）。 動態長度要強制指定長度
      throwOnInvalid,
      errors,
    ));

    ++pos; // 跳過右大括號「}」

    // 檢查 charcode，因為 Unicode 只能到 U+10FFFF，超過就是非法
    if (code !== null && code > 0x10ffff) {
      if (throwOnInvalid) {
        errors.invalidCodePoint(pos, lineStart, curLine); // 報錯
      } else {
        return { code: null, pos }; // 不報錯則回傳 null 表示失敗
      }
    }
  } else {  // 處理傳統的 \uXXXX（4 位固定長度）
    ({ code, pos } = readHexChar(
      input,
      pos,
      lineStart,
      curLine,
      4,                // 固定讀 4 位
      false,            // 不強制固定格式（這裡沒差，因為固定給 4）
      throwOnInvalid,
      errors,
    ));
  }

  // 回傳解析結果：Unicode 整數與位置
  return { code, pos };
}
