# 指尖机械转盘

> MPSTEAM Lab 的网页端机械解压玩具。

## 项目概览

- 中文名：指尖机械转盘
- 英文名：Fidget Wheel
- 线上路径：`https://lab.mpsteam.cn/fidget-wheel/`
- 目录位置：`lab-public/fidget-wheel/`
- 当前版本：`v0.1`
- 页面类型：纯静态页面，离线可玩，无账号、后端和网络接口

## 操作方式

- 鼠标或手指按住圆盘并拖动，松手后按当前速度惯性旋转。
- 转盘经过 20 个机械刻度时会短暂高亮，并在声音开启时发出轻微 click。
- 速度接近停止后，圆盘会平滑吸附到最近刻度，结果显示为 `当前：数字`。
- `随手转一下` 只随机生成初始方向和角速度，最终数字仍由实际停止角度计算。
- 转盘获得键盘焦点后，左右方向键可以拨动一格，空格或 Enter 可以随手转一下。
- 声音开关只影响 Web Audio click；震动在浏览器支持且允许时作为可选增强。

## 文件结构

```text
lab-public/fidget-wheel/
├─ index.html     # 页面结构、无框架入口
├─ styles.css     # 金属盘体、响应式布局和 reduced-motion 样式
├─ game.ts        # TypeScript 交互、物理和反馈逻辑
├─ game.js        # game.ts 的浏览器运行时编译产物
├─ tsconfig.json  # 独立 TypeScript 检查与编译配置
├─ README.md      # 项目说明
└─ CHANGELOG.md   # 更新日志
```

源码使用 TypeScript；浏览器直接加载同目录的 `game.js`，因此独立打开 `index.html` 或通过静态服务器预览都能运行。修改 `game.ts` 后执行下面的命令更新运行时文件：

```bash
npx tsc -p lab-public/fidget-wheel/tsconfig.json
```

## 本地预览

快速查看可以直接打开 `lab-public/fidget-wheel/index.html`。按仓库正式方式联调 Lab 子站：

```bash
npm run build:lab
```

构建后内容会输出到 `dist-lab/fidget-wheel/`，对应线上 `/fidget-wheel/` 路径。

## 核心物理模型

- `angularPosition`：当前轮盘角度，渲染为 `transform: rotate(...)`，每帧只更新一个元素。
- `angularVelocity`：拖动最近 110ms 的角度位移估算出的弧度 / 秒，并限制最大角速度。
- `friction`：通过指数阻尼逐帧降低角速度。
- `requestAnimationFrame`：只保留一个动画循环，速度低于停止阈值后进入吸附阶段。
- 吸附阶段使用 cubic ease-out 从当前角度平滑移动到最近的 20 等分刻度，不预先决定结果。
- 最终数字取顶部读数头对应的最近刻度：轮盘顺时针转动一格时，顶部读到的数字向前一格回绕。

## 浏览器能力降级

- Web Audio API 不可用时静默跳过 click，拖动、惯性、吸附和数字判定不受影响。
- `navigator.vibrate()` 不可用或被拒绝时不报错，视觉刻度反馈仍保留。
- `prefers-reduced-motion: reduce` 会降低最大速度、提高阻尼并缩短吸附时间，同时移除明显的按钮移动反馈。
- 页面切后台后不会把暂停期间的时间一次性算入物理步长；回到页面会从新的时间戳继续。
