# MPS Lab 赛车 D1 产品分析 SQL

表：`user_logs`

主要事件：`lab_race_finish`

反应时间字段在 `payload` JSON 里：

- `$.reactionTime`：玩家起步反应时间，单位：秒
- `$.opponentReactionTime`：对手起步反应时间，单位：秒

使用建议：

- D1 里的 `created_at` 是 UTC 时间。下面统一用 `date(created_at, '+8 hours')` 统计北京时间自然日。
- 在 Cloudflare D1 控制台里，建议一次复制一整段查询执行，不要整份文件一起跑。
- 如果用命令行，也可以这样快速查总量：

```bash
npx wrangler d1 execute mps-user-logs --remote --command "SELECT COUNT(*) FROM user_logs;"
```

当前埋点只记录“比赛完成”和“前端 JS 错误”。还不能看页面访问、开始比赛但未完成、中途退出这些漏斗指标；这些要后续加新事件。

## 1. 最近 100 条比赛完成日志

把 `payload` JSON 拆成可读字段。先跑这段，确认线上数据长什么样。

```sql
WITH race_finish AS (
  SELECT
    id,
    created_at,
    datetime(created_at, '+8 hours') AS created_at_cn,
    date(created_at, '+8 hours') AS day_cn,
    session_id,
    app_version,
    json_extract(payload, '$.version') AS payload_version,
    json_extract(payload, '$.difficulty') AS difficulty,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    CAST(json_extract(payload, '$.reactionTime') AS REAL) AS reaction_s,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.opponentReactionTime') AS REAL) AS opponent_reaction_s,
    ROUND(CAST(json_extract(payload, '$.opponentReactionTime') AS REAL) * 1000.0, 0) AS opponent_reaction_ms,
    CAST(json_extract(payload, '$.raceCount') AS INTEGER) AS race_count,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist,
    CAST(json_extract(payload, '$.money') AS INTEGER) AS money,
    CAST(json_extract(payload, '$.winStreak') AS INTEGER) AS win_streak
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
)
SELECT
  id AS "日志ID",
  created_at_cn AS "北京时间",
  session_id AS "会话ID",
  difficulty AS "难度",
  rank AS "名次",
  reaction_ms AS "玩家反应ms",
  opponent_reaction_ms AS "对手反应ms",
  race_count AS "比赛场次",
  is_practice AS "是否练习赛",
  is_ai_assist AS "是否AI托管",
  money AS "赛后资金",
  win_streak AS "连胜数",
  app_version AS "应用版本"
FROM race_finish
ORDER BY id DESC
LIMIT 100;
```

## 2. 最近 14 天“手动 + 正式赛”的反应时间总览

看用户反应时间时，优先跑这一段。重点看“样本量”“会话数”“平均反应ms”“最快反应ms”“胜率%”。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
)
SELECT
  COUNT(*) AS "样本量",
  COUNT(DISTINCT session_id) AS "会话数",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms",
  MIN(reaction_ms) AS "最快反应ms",
  MAX(reaction_ms) AS "最慢反应ms",
  ROUND(100.0 * SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS "胜率%",
  ROUND(AVG(CASE WHEN rank = 1 THEN reaction_ms END), 1) AS "冠军平均反应ms",
  ROUND(AVG(CASE WHEN rank > 1 THEN reaction_ms END), 1) AS "非冠军平均反应ms"
FROM race_finish
WHERE julianday(created_at) >= julianday('now', '-14 days')
  AND is_practice = 0
  AND is_ai_assist = 0
  AND reaction_ms IS NOT NULL;
```

## 3. 每天的手动正式赛反应时间分位数

`P50` 是中位水平，`P90`/`P95` 是偏慢用户体验。如果 `P90`/`P95` 突然变高，通常说明操作手感变差、用户设备变了，或当天样本里慢玩家更多。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    date(created_at, '+8 hours') AS day_cn,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
),
samples AS (
  SELECT day_cn, reaction_ms
  FROM race_finish
  WHERE julianday(created_at) >= julianday('now', '-30 days')
    AND is_practice = 0
    AND is_ai_assist = 0
    AND reaction_ms IS NOT NULL
),
ranked AS (
  SELECT
    day_cn,
    reaction_ms,
    ROW_NUMBER() OVER (PARTITION BY day_cn ORDER BY reaction_ms) AS rn,
    COUNT(*) OVER (PARTITION BY day_cn) AS n
  FROM samples
)
SELECT
  day_cn AS "日期",
  COUNT(*) AS "样本量",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms",
  MIN(CASE WHEN rn >= n * 0.50 THEN reaction_ms END) AS "P50反应ms",
  MIN(CASE WHEN rn >= n * 0.90 THEN reaction_ms END) AS "P90反应ms",
  MIN(CASE WHEN rn >= n * 0.95 THEN reaction_ms END) AS "P95反应ms",
  MIN(reaction_ms) AS "最快反应ms",
  MAX(reaction_ms) AS "最慢反应ms"
FROM ranked
GROUP BY day_cn
ORDER BY day_cn DESC;
```

## 4. 手动正式赛反应时间分桶

`<80ms` 通常不像正常手动点击，更像自动起步脚本，可以用来区分自然用户和脚本用户。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
),
bucketed AS (
  SELECT
    CASE
      WHEN reaction_ms < 80 THEN '00 <80ms 疑似自动起步'
      WHEN reaction_ms < 150 THEN '01 80-149ms 极快'
      WHEN reaction_ms < 250 THEN '02 150-249ms 完美'
      WHEN reaction_ms < 550 THEN '03 250-549ms 正常'
      WHEN reaction_ms < 1000 THEN '04 550-999ms 偏慢'
      ELSE '05 >=1000ms 很慢'
    END AS reaction_bucket,
    session_id,
    rank,
    reaction_ms
  FROM race_finish
  WHERE julianday(created_at) >= julianday('now', '-30 days')
    AND is_practice = 0
    AND is_ai_assist = 0
    AND reaction_ms IS NOT NULL
)
SELECT
  reaction_bucket AS "反应速度分桶",
  COUNT(*) AS "比赛场数",
  COUNT(DISTINCT session_id) AS "会话数",
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS "比赛占比%",
  ROUND(100.0 * SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS "胜率%",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms"
FROM bucketed
GROUP BY reaction_bucket
ORDER BY reaction_bucket;
```

## 5. 找出反应异常快的会话

适合排查“自动起步脚本”对数据的影响。“低于80ms次数”越高，越可能不是纯手动操作。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    datetime(created_at, '+8 hours') AS created_at_cn,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
)
SELECT
  session_id AS "会话ID",
  COUNT(*) AS "手动正式赛场数",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms",
  MIN(reaction_ms) AS "最快反应ms",
  MAX(reaction_ms) AS "最慢反应ms",
  SUM(CASE WHEN reaction_ms < 80 THEN 1 ELSE 0 END) AS "低于80ms次数",
  SUM(CASE WHEN reaction_ms < 150 THEN 1 ELSE 0 END) AS "低于150ms次数",
  ROUND(100.0 * SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS "胜率%",
  MAX(created_at_cn) AS "最近出现时间"
FROM race_finish
WHERE julianday(created_at) >= julianday('now', '-30 days')
  AND is_practice = 0
  AND is_ai_assist = 0
  AND reaction_ms IS NOT NULL
GROUP BY session_id
HAVING COUNT(*) >= 3
ORDER BY "低于80ms次数" DESC, "平均反应ms" ASC
LIMIT 50;
```

## 6. 按难度看胜率和反应时间

如果某个难度下用户反应已经很快，但胜率仍然很低，说明数值可能太难。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    session_id,
    json_extract(payload, '$.difficulty') AS difficulty,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.raceCount') AS INTEGER) AS race_count,
    CAST(json_extract(payload, '$.money') AS INTEGER) AS money,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
)
SELECT
  difficulty AS "难度",
  COUNT(*) AS "比赛场数",
  COUNT(DISTINCT session_id) AS "会话数",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms",
  ROUND(100.0 * SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS "胜率%",
  ROUND(AVG(race_count), 1) AS "平均比赛场次",
  ROUND(AVG(money), 1) AS "平均赛后资金"
FROM race_finish
WHERE julianday(created_at) >= julianday('now', '-30 days')
  AND is_practice = 0
  AND is_ai_assist = 0
GROUP BY difficulty
ORDER BY CASE difficulty
  WHEN 'easy' THEN 1
  WHEN 'normal' THEN 2
  WHEN 'hard' THEN 3
  WHEN 'expert' THEN 4
  WHEN 'nightmare' THEN 5
  ELSE 99
END;
```

## 7. 反应速度与比赛结果关系

用来看：起步反应是否明显影响名次。仅统计最近 30 天、正式赛、非 AI 托管、有反应时间的数据。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
    AND julianday(created_at) >= julianday('now', '-30 days')
),

bucketed AS (
  SELECT
    CASE
      WHEN reaction_ms < 150 THEN '00 小于150ms'
      WHEN reaction_ms < 250 THEN '01 150-249ms'
      WHEN reaction_ms < 550 THEN '02 250-549ms'
      WHEN reaction_ms < 1000 THEN '03 550-999ms'
      ELSE '04 大于等于1000ms'
    END AS reaction_bucket,
    session_id,
    rank,
    reaction_ms
  FROM race_finish
  WHERE is_practice = 0
    AND is_ai_assist = 0
    AND reaction_ms IS NOT NULL
)

SELECT
  reaction_bucket AS "反应速度分桶",
  COUNT(*) AS "比赛场数",
  COUNT(DISTINCT session_id) AS "会话数",

  ROUND(AVG(reaction_ms), 0) AS "平均反应ms",
  ROUND(AVG(rank), 2) AS "平均名次",

  SUM(
    CASE
      WHEN rank = 1 THEN 1
      ELSE 0
    END
  ) AS "冠军场数",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN rank = 1 THEN 1
        ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    1
  ) AS "冠军率%",

  SUM(
    CASE
      WHEN rank <= 3 THEN 1
      ELSE 0
    END
  ) AS "前三场数",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN rank <= 3 THEN 1
        ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    1
  ) AS "前三率%"

FROM bucketed
GROUP BY reaction_bucket
ORDER BY reaction_bucket;
```

## 8. 按比赛场次阶段看压力

用来发现玩家从第几场开始明显变难、输钱或胜率下滑。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    session_id,
    json_extract(payload, '$.difficulty') AS difficulty,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.raceCount') AS INTEGER) AS race_count,
    CAST(json_extract(payload, '$.money') AS INTEGER) AS money,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
),
banded AS (
  SELECT
    CASE
      WHEN race_count < 5 THEN '00 race 0-4'
      WHEN race_count < 12 THEN '01 race 5-11'
      WHEN race_count < 20 THEN '02 race 12-19'
      WHEN race_count < 35 THEN '03 race 20-34'
      ELSE '04 race 35+'
    END AS race_count_band,
    difficulty,
    session_id,
    rank,
    reaction_ms,
    money
  FROM race_finish
  WHERE julianday(created_at) >= julianday('now', '-30 days')
    AND is_practice = 0
    AND is_ai_assist = 0
)
SELECT
  race_count_band AS "比赛阶段",
  difficulty AS "难度",
  COUNT(*) AS "比赛场数",
  COUNT(DISTINCT session_id) AS "会话数",
  ROUND(AVG(reaction_ms), 1) AS "平均反应ms",
  ROUND(100.0 * SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS "胜率%",
  ROUND(AVG(money), 1) AS "平均完赛后资金"
FROM banded
GROUP BY race_count_band, difficulty
ORDER BY race_count_band, difficulty;
```

## 9. 每天的模式占比：手动正式赛 / AI 托管 / 练习赛

用来看用户到底是在真实手动玩，还是更多依赖 AI 托管或练习。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    date(created_at, '+8 hours') AS day_cn,
    session_id,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
    AND julianday(created_at) >= julianday('now', '-30 days')
)

SELECT
  day_cn AS "日期",
  COUNT(*) AS "完赛总数",
  COUNT(DISTINCT session_id) AS "会话数",

  SUM(
    CASE
      WHEN is_practice = 0 AND is_ai_assist = 0 THEN 1
      ELSE 0
    END
  ) AS "手动正式赛",

  SUM(
    CASE
      WHEN is_ai_assist = 1 THEN 1
      ELSE 0
    END
  ) AS "AI托管",

  SUM(
    CASE
      WHEN is_practice = 1 THEN 1
      ELSE 0
    END
  ) AS "练习赛",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN is_practice = 0 AND is_ai_assist = 0 THEN 1
        ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    1
  ) AS "手动正式赛占比%",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN is_ai_assist = 1 THEN 1
        ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    1
  ) AS "AI托管占比%",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN is_practice = 1 THEN 1
        ELSE 0
      END
    ) / NULLIF(COUNT(*), 0),
    1
  ) AS "练习赛占比%",

  ROUND(
    1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT session_id), 0),
    1
  ) AS "平均每会话完赛"

FROM race_finish
GROUP BY day_cn
ORDER BY day_cn DESC;
```

## 10. 每天的会话参与度

`session_id` 是本地 24 小时会话，不是永久用户 ID。重点看“活跃会话数”“平均每会话完赛”“完成3场以上会话数”“完成10场以上会话数”。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    date(created_at, '+8 hours') AS day_cn,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
),
session_day AS (
  SELECT
    day_cn,
    session_id,
    COUNT(*) AS finish_count,
    SUM(CASE WHEN is_practice = 0 AND is_ai_assist = 0 THEN 1 ELSE 0 END) AS manual_formal_count,
    SUM(CASE WHEN is_practice = 0 AND is_ai_assist = 0 AND rank = 1 THEN 1 ELSE 0 END) AS manual_formal_wins,
    MIN(CASE WHEN is_practice = 0 AND is_ai_assist = 0 THEN reaction_ms END) AS best_manual_reaction_ms
  FROM race_finish
  WHERE julianday(created_at) >= julianday('now', '-30 days')
  GROUP BY day_cn, session_id
)
SELECT
  day_cn AS "日期",
  COUNT(*) AS "活跃会话数",
  SUM(finish_count) AS "完赛总数",
  ROUND(AVG(finish_count), 1) AS "平均每会话完赛",
  SUM(CASE WHEN finish_count >= 3 THEN 1 ELSE 0 END) AS "完成3场以上会话数",
  SUM(CASE WHEN finish_count >= 10 THEN 1 ELSE 0 END) AS "完成10场以上会话数",
  ROUND(AVG(best_manual_reaction_ms), 1) AS "会话最佳手动反应均值ms",
  ROUND(
    100.0 * SUM(manual_formal_wins) / NULLIF(SUM(manual_formal_count), 0),
    1
  ) AS "手动正式赛胜率%"
FROM session_day
GROUP BY day_cn
ORDER BY day_cn DESC;
```

## 11. 按版本看完成量、会话数、反应时间和胜率

如果发版后某个版本胜率或反应时间异常，就从这里开始排查。

```sql
WITH race_finish AS (
  SELECT
    created_at,
    COALESCE(app_version, json_extract(payload, '$.version'), 'unknown') AS version,
    session_id,
    CAST(json_extract(payload, '$.rank') AS INTEGER) AS rank,
    ROUND(CAST(json_extract(payload, '$.reactionTime') AS REAL) * 1000.0, 0) AS reaction_ms,
    CAST(json_extract(payload, '$.isPractice') AS INTEGER) AS is_practice,
    CAST(json_extract(payload, '$.isAiAssist') AS INTEGER) AS is_ai_assist
  FROM user_logs
  WHERE event_name = 'lab_race_finish'
    AND source = 'race'
    AND json_valid(payload)
    AND julianday(created_at) >= julianday('now', '-30 days')
)

SELECT
  version AS "版本",
  COUNT(*) AS "完赛总数",
  COUNT(DISTINCT session_id) AS "会话数",

  SUM(
    CASE
      WHEN is_practice = 0 AND is_ai_assist = 0 THEN 1
      ELSE 0
    END
  ) AS "手动正式赛场数",

  ROUND(
    AVG(
      CASE
        WHEN is_practice = 0 AND is_ai_assist = 0 THEN reaction_ms
      END
    ),
    1
  ) AS "手动平均反应ms",

  ROUND(
    100.0 * SUM(
      CASE
        WHEN is_practice = 0
          AND is_ai_assist = 0
          AND rank = 1
        THEN 1
        ELSE 0
      END
    ) / NULLIF(
      SUM(
        CASE
          WHEN is_practice = 0 AND is_ai_assist = 0 THEN 1
          ELSE 0
        END
      ),
      0
    ),
    1
  ) AS "手动胜率%"

FROM race_finish
GROUP BY version
ORDER BY COUNT(*) DESC;
```

## 12. 最近 30 天前端错误

看错误信息、文件、行列号和命中次数，优先修命中次数高、影响会话多的问题。

```sql
WITH error_logs AS (
  SELECT
    id,
    created_at,
    datetime(created_at, '+8 hours') AS created_at_cn,
    date(created_at, '+8 hours') AS day_cn,
    session_id,
    app_version,
    json_extract(payload, '$.message') AS message,
    json_extract(payload, '$.file') AS file,
    CAST(json_extract(payload, '$.line') AS INTEGER) AS line,
    CAST(json_extract(payload, '$.column') AS INTEGER) AS column
  FROM user_logs
  WHERE event_name = 'lab_error'
    AND source = 'race'
    AND json_valid(payload)
)
SELECT
  day_cn AS "日期",
  message AS "错误信息",
  file AS "文件",
  line AS "行号",
  column AS "列号",
  COUNT(*) AS "命中次数",
  COUNT(DISTINCT session_id) AS "影响会话数",
  MAX(created_at_cn) AS "最近出现时间",
  GROUP_CONCAT(DISTINCT app_version) AS "版本列表"
FROM error_logs
WHERE julianday(created_at) >= julianday('now', '-30 days')
GROUP BY day_cn, message, file, line, column
ORDER BY "日期" DESC, "命中次数" DESC
LIMIT 100;
```
