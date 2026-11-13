# 動作與武器

## 結論

人物用 Quaternius 現在這套通用骨架，骨頭名字像 `hand_r`、`spine_03`。兩包的靜止姿勢相同，所以片段直接接在同一個角色上，沒有再換一套軸。

- 第一包 `assets/human/UAL1_Standard.glb`：待機、走路、跑步、蹲、手槍瞄準、開槍、裝彈，以及持刀的 `Sword_Idle`。
- 第二包 `assets/human/UAL2_Standard.glb`：揮刀用 `Sword_Regular_A`。爬梯和翻越用 `ClimbUp_1m`。

這兩包都是 CC0，出處是 https://quaternius.com/packs/universalanimationlibrary.html 和 https://quaternius.com/packs/universalanimationlibrary2.html 。

`ClimbUp_1m` 是翻上約 1 公尺的動作，不是一階一階的梯子。免費包裡沒有逐階爬梯。梯子仍是一步一步把人抬上去，身上播的是這段現成動作，不再自己擺手腳。

槍的插槽仍是固定在右手上，不每幀重算。

## 沒有採用的

- 舊的 Godot Standard（`DEF-` 骨頭）沒有爬梯、翻越、短砍，所以換掉。
- Mixamo 有逐階爬梯，授權不准把動作檔放進公開倉庫。
- 付費的完整版才有翻上 2 公尺和另一段翻越。這次用的是免費的 `ClimbUp_1m`。
