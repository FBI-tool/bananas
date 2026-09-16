BIN_NAME = p2p-kiwi

macos:
	TARGET_PLATFORM=macos ./scripts/build.sh

linux:
	TARGET_PLATFORM=linux ./scripts/build.sh

linux-arm64:
	TARGET_PLATFORM=linux-arm64 ./scripts/build.sh

linux-debug:
	TARGET_PLATFORM=linux-debug ./scripts/build.sh

windows:
	TARGET_PLATFORM=windows ./scripts/build.sh

release:
	TARGET_PLATFORM=all ./scripts/release.sh

linux-release:
	REPLACE=1 TARGET_PLATFORM=linux ./scripts/release.sh

linux-arm64-release:
	REPLACE=1 TARGET_PLATFORM=linux-arm64 ./scripts/release.sh

windows-release:
	REPLACE=1 TARGET_PLATFORM=windows ./scripts/release.sh

macos-release:
	REPLACE=1 TARGET_PLATFORM=macos ./scripts/release.sh

version:
	./scripts/set-version.sh

run:
	pnpm run dev
