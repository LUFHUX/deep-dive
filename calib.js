/*
 * 深潜 · 形态阈值标定（tools/calib.js 产出，600 张/尺寸）
 *
 * purpleP75 / blankP75 = 该尺寸下紫比例 / 空白比例的 75 分位。
 * A 型（模糊）= 紫比例 ≥ purpleP75；B 型（荒芜）= 空白比例 ≥ blankP75。
 */
var DeepDiveCalib = {
  "6x6": { purpleP75: 0.4, blankP75: 0.2778, maxMedian: 3 },
  "6x7": { purpleP75: 0.32, blankP75: 0.3571, maxMedian: 3 },
  "7x7": { purpleP75: 0.4, blankP75: 0.2041, maxMedian: 4 },
  "7x8": { purpleP75: 0.4054, blankP75: 0.25, maxMedian: 4 },
  "8x8": { purpleP75: 0.4118, blankP75: 0.2031, maxMedian: 4 },
  "8x9": { purpleP75: 0.3556, blankP75: 0.25, maxMedian: 4 },
  "9x9": { purpleP75: 0.413, blankP75: 0.1852, maxMedian: 4 },
  "9x10": { purpleP75: 0.3889, blankP75: 0.2222, maxMedian: 4 },
  "9x11": { purpleP75: 0.3594, blankP75: 0.2424, maxMedian: 4 },
  "8x12": { purpleP75: 0.3774, blankP75: 0.2292, maxMedian: 4 },
  "7x14": { purpleP75: 0.3846, blankP75: 0.2143, maxMedian: 4 },
  "6x16": { purpleP75: 0.3871, blankP75: 0.2083, maxMedian: 4 },
  "5x20": { purpleP75: 0.3729, blankP75: 0.22, maxMedian: 4 },
  "10x10": { purpleP75: 0.4286, blankP75: 0.16, maxMedian: 5 },
  "10x20": { purpleP75: 0.3893, blankP75: 0.19, maxMedian: 5 }
};
