# 项目协作约定

## Git 提交身份

- 本项目的人工提交必须使用仓库当前配置的用户身份；当前提交者名称为 `Zhang`。
- 不得将 Codex、OpenAI、Agent 或机器人写为人工提交的 Author、Committer 或 Co-authored-by。
- 提交前应检查 `git config --local user.name` 与 `git config --local user.email`，确认身份配置仍属于项目所有者。
- GitHub Actions 自动采集数据产生的提交继续使用机器人身份，以便区分人工修改与自动更新。

## 同步规则

- 推送前先获取远端更新，并优先使用 rebase 保持提交历史清晰。
- 不使用强制推送覆盖远端自动采集的数据提交。
