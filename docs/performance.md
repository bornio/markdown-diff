# Performance review

Measured code revision `284eb239cd5107c024223e8a95dd133857520fd6`.

## Results

These are medians of five alternating browser trials per version. Each document contains 50,000 code lines. The quoted case also contains an introduction and closing paragraph.

| Workload | Before | After | Latency reduction |
| --- | ---: | ---: | ---: |
| Fenced code, 6.48 MB combined input | 957.6 ms | 503.4 ms | 47.4% |
| Code inside a blockquote, 6.68 MB combined input | 1003.5 ms | 545.0 ms | 45.7% |

The direct-code comparison uses the original `aa23ca0` revision. The quoted-code comparison uses `ccabc20`, before the nested-code fix.

The final direct-code range was 475.9 to 509.0 ms, versus 921.1 to 971.0 ms before. The final quoted-code range was 526.5 to 576.3 ms, versus 971.5 to 1019.6 ms before. Both improvements exceed the recorded variation.

The long-task observer recorded no task of 50 ms or longer in the 30 final measurement windows. The original code trials recorded tasks up to 441 ms, and the quoted-code trials up to 467 ms. These observer records do not prove exhaustive task capture. Latency ranges for the example, prose, and table workloads overlapped. Those results do not establish a speedup.

## Method

Production Vite builds ran on one Mac with 10 logical CPU cores. Comparison trials used normal caching and fresh input files. Timing begins at the file-drop event. It ends after rendered rows exist and two animation-frame callbacks run. It includes file reading, decoding, worker startup, comparison, message delivery, and initial DOM construction. It is a first-render observation, not a browser paint-timing or interaction-percentile metric.

The six workloads were the built-in example, 100-section prose, 2,000-section prose, a 2,000-row table, large fenced code, and large quoted code. Each trial also opened Source and switched the theme. All 60 before/after trials completed without a workload error. Separate profiles identified layout of the complete visible code block as the main-thread cost. Profiled timings were excluded from the trial results.

An isolated dynamic-example import reduced entry bytes but produced overlapping home-page paint times and slower example loading. That change was rejected.

## Changes and checks

The comparison result no longer includes unused joined HTML or whole-block HTML alongside pages. Large recognized code blocks use the existing pager, including code inside blockquotes, divs, and lists. Formatting comparison builds structural arrays and serializes each operand once, avoiding repeated JSON escaping with nested inline markup.

All 32 correctness tests pass. They cover source reconstruction, code-part boundaries, annotations, Unicode, line endings, gaps, surrounding content, list numbering, tables, and sanitization. Browser checks cover file selection, paging, Source fidelity, saved view position, and cancellation.

## Council review

Rounds: 2.

| Delegate | Round 1 | Round 2 |
| --- | ---: | ---: |
| GPT-6.1 Sol, xhigh, A | 9.3/10 | 9.5/10 |
| GPT-6.1 Terra, max | 9.3/10 | 9.5/10 |
| GPT-6.1 Sol, xhigh, B | 9.3/10 | 9.5/10 |

Every final loading, rendering, and general-responsiveness score is at least 9.5. These are independent engineering judgments, not benchmark scores.

## Limits

These measurements cover one host and the initial view, Source switch, and theme switch. They do not measure low-end devices, peak memory, or scrolling through every row. Mounted rows accumulate during traversal. Very long source lines, oversized prose, code inside table cells or details, and unsupported raw code markup remain outside the code-paging bound. Rendering one code part also means selection cannot span parts. Source retains the complete file.
