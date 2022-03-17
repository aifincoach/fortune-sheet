import numeral from "numeral";
import { isRealNum, valueIsError, isdatetime } from "./validation";
import { getCellValue } from "./cell";
import SSF from "./ssf";
import _ from "lodash";

const XLMLFormatMap /* {[string]:string} */ = {
  "General Number": "General",
  "General Date": SSF._table[22],
  "Long Date": "dddd, mmmm dd, yyyy",
  "Medium Date": SSF._table[15],
  "Short Date": SSF._table[14],
  "Long Time": SSF._table[19],
  "Medium Time": SSF._table[18],
  "Short Time": SSF._table[20],
  Currency: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  Fixed: SSF._table[2],
  Standard: SSF._table[4],
  Percent: SSF._table[10],
  Scientific: SSF._table[11],
  "Yes/No": '"Yes";"Yes";"No";@',
  "True/False": '"True";"True";"False";@',
  "On/Off": '"Yes";"Yes";"No";@',
};

const unescapexml = (() => {
  /* 22.4.2.4 bstr (Basic String) */
  const encregex = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/g;
  const coderegex = /_x([\da-fA-F]{4})_/g;
  return function unescapexml(text) {
    const s = `${text}`;
    const i = s.indexOf("<![CDATA[");
    if (i === -1)
      return s
        .replace(encregex, function ($$, $1) {
          return (
            encodings[$$] ||
            String.fromCharCode(parseInt($1, $$.indexOf("x") > -1 ? 16 : 10)) ||
            $$
          );
        })
        .replace(coderegex, function (m, c) {
          return String.fromCharCode(parseInt(c, 16));
        });
    const j = s.indexOf("]]>");
    return (
      unescapexml(s.slice(0, i)) +
      s.slice(i + 9, j) +
      unescapexml(s.slice(j + 3))
    );
  };
})();

const basedate = new Date(1899, 11, 31, 0, 0, 0);
const dnthresh = basedate.getTime();
const base1904 = new Date(1900, 2, 1, 0, 0, 0);

export function datenum_local(v: Date, date1904?: number) {
  let epoch = Date.UTC(
    v.getFullYear(),
    v.getMonth(),
    v.getDate(),
    v.getHours(),
    v.getMinutes(),
    v.getSeconds()
  );
  const dnthresh_utc = Date.UTC(1899, 11, 31, 0, 0, 0);

  if (date1904) epoch -= 1461 * 24 * 60 * 60 * 1000;
  else if (v >= base1904) epoch += 24 * 60 * 60 * 1000;
  return (epoch - dnthresh_utc) / (24 * 60 * 60 * 1000);
}

let good_pd_date = new Date("2017-02-19T19:06:09.000Z");
if (Number.isNaN(good_pd_date.getFullYear()))
  good_pd_date = new Date("2/19/17");
const good_pd = good_pd_date.getFullYear() === 2017;

/* parses a date as a local date */
function parseDate(str: string | Date, fixdate?: number) {
  const d = new Date(str);
  // console.log(d);
  if (good_pd) {
    if (!_.isNil(fixdate)) {
      if (fixdate > 0)
        d.setTime(d.getTime() + d.getTimezoneOffset() * 60 * 1000);
      else if (fixdate < 0)
        d.setTime(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
    }
    return d;
  }
  if (str instanceof Date) return str;
  if (good_pd_date.getFullYear() === 1917 && !Number.isNaN(d.getFullYear())) {
    const s = d.getFullYear();
    if (str.indexOf(`${s}`) > -1) return d;
    d.setFullYear(d.getFullYear() + 100);
    return d;
  }
  const n = str.match(/\d+/g) || ["2017", "2", "19", "0", "0", "0"];
  let out = new Date(
    +n[0],
    +n[1] - 1,
    +n[2],
    +n[3] || 0,
    +n[4] || 0,
    +n[5] || 0
  );
  if (str.indexOf("Z") > -1)
    out = new Date(out.getTime() - out.getTimezoneOffset() * 60 * 1000);
  return out;
}

/* TODO: stress test */
function fuzzynum(s) {
  let v = Number(s);
  if (typeof s === "number") {
    return s;
  }
  if (!Number.isNaN(v)) return v;
  let wt = 1;
  let ss = s
    .replace(/([\d]),([\d])/g, "$1$2")
    .replace(/[$]/g, "")
    .replace(/[%]/g, function () {
      wt *= 100;
      return "";
    });
  if (!Number.isNaN((v = Number(ss)))) return v / wt;
  ss = ss.replace(/[(](.*)[)]/, function ($$, $1) {
    wt = -wt;
    return $1;
  });
  if (!Number.isNaN((v = Number(ss)))) return v / wt;
  return v;
}

function fuzzydate(s) {
  const o = new Date(s);
  const n = new Date(NaN);
  const y = o.getYear();
  const m = o.getMonth();
  const d = o.getDate();
  if (Number.isNaN(d)) return n;
  if (y < 0 || y > 8099) return n;
  if ((m > 0 || d > 1) && y != 101) return o;
  if (s.toLowerCase().match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/))
    return o;
  if (s.match(/[^-0-9:,\/\\]/)) return n;
  return o;
}

export function genarate(value: string) {
  // 万 单位格式增加！！！
  const ret = [];
  let m: string | null = null;
  let ct: any = {};
  let v: any = value;

  if (_.isNil(value)) {
    return null;
  }

  if (/^-?[0-9]{1,}[,][0-9]{3}(.[0-9]{1,2})?$/.test(value)) {
    // 表述金额的字符串，如：12,000.00 或者 -12,000.00
    m = value;
    v = Number(value.split(".")[0].replace(",", ""));
    let fa = "#,##0";
    if (value.split(".")[1]) {
      fa = "#,##0.";
      for (let i = 0; i < value.split(".")[1].length; i += 1) {
        fa += 0;
      }
    }
    ct = { fa, t: "n" };
  } else if (value.toString().substr(0, 1) === "'") {
    m = value.toString().substr(1);
    ct = { fa: "@", t: "s" };
  } else if (value.toString().toUpperCase() === "TRUE") {
    m = "TRUE";
    ct = { fa: "General", t: "b" };
    v = true;
  } else if (value.toString().toUpperCase() === "FALSE") {
    m = "FALSE";
    ct = { fa: "General", t: "b" };
    v = false;
  } else if (valueIsError(value)) {
    m = value.toString();
    ct = { fa: "General", t: "e" };
  } else if (
    /^\d{6}(18|19|20)?\d{2}(0[1-9]|1[12])(0[1-9]|[12]\d|3[01])\d{3}(\d|X)$/i.test(
      value
    )
  ) {
    m = value.toString();
    ct = { fa: "@", t: "s" };
  } else if (
    isRealNum(value) &&
    Math.abs(parseFloat(value)) > 0 &&
    (Math.abs(parseFloat(value)) >= 1e11 || Math.abs(parseFloat(value)) < 1e-9)
  ) {
    v = numeral(value).value();
    const str = v.toExponential();
    if (str.indexOf(".") > -1) {
      let strlen = str.split(".")[1].split("e")[0].length;
      if (strlen > 5) {
        strlen = 5;
      }

      ct = { fa: `#0.${new Array(strlen + 1).join("0")}E+00`, t: "n" };
    } else {
      ct = { fa: "#0.E+00", t: "n" };
    }

    m = SSF.format(ct.fa, v);
  } else if (value.toString().indexOf("%") > -1) {
    const index = value.toString().indexOf("%");
    var value2 = value.toString().substring(0, index);
    const value3 = value2.replace(/,/g, "");

    if (index === value.toString().length - 1 && isRealNum(value3)) {
      if (value2.indexOf(".") > -1) {
        if (value2.indexOf(".") == value2.lastIndexOf(".")) {
          const value4 = value2.split(".")[0];
          const value5 = value2.split(".")[1];

          var len = value5.length;
          if (len > 9) {
            len = 9;
          }

          if (value4.indexOf(",") > -1) {
            var isThousands = true;
            var ThousandsArr = value4.split(",");

            for (var i = 1; i < ThousandsArr.length; i++) {
              if (ThousandsArr[i].length < 3) {
                isThousands = false;
                break;
              }
            }

            if (isThousands) {
              ct = {
                fa: `#,##0.${new Array(len + 1).join("0")}%`,
                t: "n",
              };
              v = numeral(value).value();
              m = SSF.format(ct.fa, v);
            } else {
              m = value.toString();
              ct = { fa: "@", t: "s" };
            }
          } else {
            ct = { fa: `0.${new Array(len + 1).join("0")}%`, t: "n" };
            v = numeral(value).value();
            m = SSF.format(ct.fa, v);
          }
        } else {
          m = value.toString();
          ct = { fa: "@", t: "s" };
        }
      } else if (value2.indexOf(",") > -1) {
        var isThousands = true;
        var ThousandsArr = value2.split(",");

        for (var i = 1; i < ThousandsArr.length; i++) {
          if (ThousandsArr[i].length < 3) {
            isThousands = false;
            break;
          }
        }

        if (isThousands) {
          ct = { fa: "#,##0%", t: "n" };
          v = numeral(value).value();
          m = SSF.format(ct.fa, v);
        } else {
          m = value.toString();
          ct = { fa: "@", t: "s" };
        }
      } else {
        ct = { fa: "0%", t: "n" };
        v = numeral(value).value();
        m = SSF.format(ct.fa, v);
      }
    } else {
      m = value.toString();
      ct = { fa: "@", t: "s" };
    }
  } else if (value.toString().indexOf(".") > -1) {
    if (value.toString().indexOf(".") == value.toString().lastIndexOf(".")) {
      const value1 = value.toString().split(".")[0];
      var value2 = value.toString().split(".")[1];

      var len = value2.length;
      if (len > 9) {
        len = 9;
      }

      if (value1.indexOf(",") > -1) {
        var isThousands = true;
        var ThousandsArr = value1.split(",");

        for (var i = 1; i < ThousandsArr.length; i += 1) {
          if (!isRealNum(ThousandsArr[i]) || ThousandsArr[i].length < 3) {
            isThousands = false;
            break;
          }
        }

        if (isThousands) {
          ct = { fa: `#,##0.${new Array(len + 1).join("0")}`, t: "n" };
          v = numeral(value).value();
          m = SSF.format(ct.fa, v);
        } else {
          m = value.toString();
          ct = { fa: "@", t: "s" };
        }
      } else {
        if (isRealNum(value1) && isRealNum(value2)) {
          ct = { fa: `0.${new Array(len + 1).join("0")}`, t: "n" };
          v = numeral(value).value();
          m = SSF.format(ct.fa, v);
        } else {
          m = value.toString();
          ct = { fa: "@", t: "s" };
        }
      }
    } else {
      m = value.toString();
      ct = { fa: "@", t: "s" };
    }
  } else if (isRealNum(value)) {
    m = value.toString();
    ct = { fa: "General", t: "n" };
    v = parseFloat(value);
  } else if (
    isdatetime(value) &&
    (value.toString().indexOf(".") > -1 ||
      value.toString().indexOf(":") > -1 ||
      value.toString().length < 16)
  ) {
    v = datenum_local(parseDate(value.toString().replace(/-/g, "/")));

    if (v.toString().indexOf(".") > -1) {
      if (value.toString().length > 18) {
        ct.fa = "yyyy-MM-dd hh:mm:ss";
      } else if (value.toString().length > 11) {
        ct.fa = "yyyy-MM-dd hh:mm";
      } else {
        ct.fa = "yyyy-MM-dd";
      }
    } else {
      ct.fa = "yyyy-MM-dd";
    }

    ct.t = "d";
    m = SSF.format(ct.fa, v);
  } else {
    m = value;
    ct.fa = "General";
    ct.t = "g";
  }

  return [m, ct, v];
}

export function update(fmt: string, v: any) {
  return SSF.format(fmt, v);
}

export function is_date(fmt: string, v?: any) {
  return SSF.is_date(fmt, v);
}
