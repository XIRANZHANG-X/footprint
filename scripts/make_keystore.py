"""生成安卓正式签名密钥（决策 0017 第 1 条）。只需要跑一次。

密钥和口令放在仓库外的文件夹里，另外在 android/ 下写一份 keystore.properties 给 Gradle 读
（这个文件不进 git）。口令随机生成，不会打印出来。

用法：python scripts/make_keystore.py <放密钥的文件夹> <keytool.exe 的路径>
"""

import os
import secrets
import string
import subprocess
import sys
from pathlib import Path

ALIAS = "footprint"
# 证书里的名字会随安装包公开，只写项目名，不写个人信息
DNAME = "CN=footprint-journal, O=footprint-journal"
VALIDITY_DAYS = 10000  # 约 27 年；安卓要求至少覆盖 App 的整个寿命


def main() -> None:
    out_dir = Path(sys.argv[1]).resolve()
    keytool = sys.argv[2]
    repo = Path(__file__).resolve().parent.parent
    if repo in out_dir.parents or out_dir == repo:
        sys.exit("密钥文件夹不能放在仓库里面")

    store = out_dir / "footprint-release.jks"
    if store.exists():
        sys.exit(f"{store} 已经存在，不覆盖：密钥一旦换了，已经装上的 App 就没法覆盖更新")
    out_dir.mkdir(parents=True, exist_ok=True)

    alphabet = string.ascii_letters + string.digits
    password = "".join(secrets.choice(alphabet) for _ in range(32))

    env = {**os.environ, "FJ_STOREPASS": password}
    subprocess.run(
        [
            keytool,
            "-genkeypair",
            "-keystore", str(store),
            "-storetype", "PKCS12",
            "-alias", ALIAS,
            "-keyalg", "RSA",
            "-keysize", "4096",
            "-validity", str(VALIDITY_DAYS),
            "-dname", DNAME,
            # PKCS12 的密钥口令和库口令必须相同
            "-storepass:env", "FJ_STOREPASS",
            "-keypass:env", "FJ_STOREPASS",
            "-noprompt",
        ],
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )

    props = "\n".join(
        [
            "# 安卓正式签名（决策 0017）。不进 git；和 footprint-release.jks 一起备份，丢了就再也发不了能覆盖安装的更新",
            f"storeFile={store.as_posix()}",
            f"storePassword={password}",
            f"keyAlias={ALIAS}",
            f"keyPassword={password}",
            "",
        ]
    )
    (out_dir / "keystore.properties").write_text(props, encoding="utf-8")
    (repo / "android" / "keystore.properties").write_text(props, encoding="utf-8")
    (out_dir / "README.txt").write_text(
        "足迹手账的安卓正式签名。\n\n"
        "footprint-release.jks 是密钥，keystore.properties 里是口令。两个文件一起备份到别处"
        "（网盘、U 盘），不要发给别人，也不要放进 git 仓库。\n"
        "换电脑打包时，把 keystore.properties 复制到仓库的 android/ 下，并把里面的 storeFile 改成新路径。\n",
        encoding="utf-8",
    )
    print(f"已生成：{store}")


if __name__ == "__main__":
    main()
