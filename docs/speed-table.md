# RoastCast speed table

Measured on 2026-11-21 from `data/timing-log.jsonl`. All times count from the moment the roast is triggered. Median (p50) and 90th percentile (p90).

## Best of 3 (self-pick)  (15 roasts)

| Step | What it measures | p50 | p90 | n | Target |
| --- | --- | --- | --- | --- | --- |
| Reaction (fast lane) | trigger to the reaction sound being started (speaker latency not included) | 0 ms | 0 ms | 15 | under 100 ms |
| Detect (speech only) | last sound to the decision to roast | 729 ms | 1.57 s | 4 | 100-400 ms |
| Build the prompt | server builds the prompt | 0 ms | 0 ms | 15 | under 50 ms |
| First LLM token | writer starts answering | 423 ms | 533 ms | 15 | 300-700 ms |
| Write | roast text is final (all takes written) | 783 ms | 1.04 s | 15 |  |
| Voice, first audio | server: voice request to first audio byte | 162 ms | 169 ms | 15 | 200-400 ms |
| Voice, in the browser | browser asks for audio until it plays | 220 ms | 233 ms | 15 | 50-400 ms |
| Roast starts speaking | trigger to the first word of the roast | 1.02 s | 1.26 s | 15 | about 1-2 s, ceiling 3 s |

Roast starts in under 3 s: 100% of roasts. Under 1.5 s: 100%.

## Quick (one roast)  (10 roasts)

| Step | What it measures | p50 | p90 | n | Target |
| --- | --- | --- | --- | --- | --- |
| Reaction (fast lane) | trigger to the reaction sound being started (speaker latency not included) | 0 ms | 0 ms | 10 | under 100 ms |
| Build the prompt | server builds the prompt | 0 ms | 0 ms | 10 | under 50 ms |
| First LLM token | writer starts answering | 393 ms | 658 ms | 10 | 300-700 ms |
| Write | roast text is final (all takes written) | 524 ms | 790 ms | 10 |  |
| Voice, first audio | server: voice request to first audio byte | 160 ms | 172 ms | 10 | 200-400 ms |
| Voice, in the browser | browser asks for audio until it plays | 229 ms | 249 ms | 10 | 50-400 ms |
| Roast starts speaking | trigger to the first word of the roast | 763 ms | 1.00 s | 10 | about 1-2 s, ceiling 3 s |

Roast starts in under 3 s: 100% of roasts. Under 1.5 s: 100%.

## Best of 3 + judge (Day 3)  (12 roasts)

| Step | What it measures | p50 | p90 | n | Target |
| --- | --- | --- | --- | --- | --- |
| Reaction (fast lane) | trigger to the reaction sound being started (speaker latency not included) | 0 ms | 0 ms | 12 | under 100 ms |
| Build the prompt | server builds the prompt | 0 ms | 0 ms | 12 | under 50 ms |
| First LLM token | writer starts answering | 414 ms | 484 ms | 12 | 300-700 ms |
| Write | roast text is final (all takes written) | 694 ms | 866 ms | 12 |  |
| Judge | separate judge call ("best" mode only) | 428 ms | 601 ms | 12 |  |
| Write + judge | roast text is final (with the judge) | 1.12 s | 1.33 s | 12 |  |
| Voice, first audio | server: voice request to first audio byte | 169 ms | 193 ms | 12 | 200-400 ms |
| Voice, in the browser | browser asks for audio until it plays | 224 ms | 249 ms | 12 | 50-400 ms |
| Roast starts speaking | trigger to the first word of the roast | 1.39 s | 1.57 s | 12 | about 1-2 s, ceiling 3 s |

Roast starts in under 3 s: 100% of roasts. Under 1.5 s: 50%.
