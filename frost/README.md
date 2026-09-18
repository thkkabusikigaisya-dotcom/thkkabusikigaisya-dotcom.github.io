# FROST v0.1 — NEXELIQ

iPhone向け短尺動画ローカル加工PWAのMVP。

## CORE LOOP
1. iPhoneで動画を選ぶ
2. ブラウザ内FFmpegで最大1280pxへ縮小
3. `gblur=sigma=24:steps=2` で全画面ブラー
4. `-an` で音声トラック削除
5. `-map_metadata -1` でメタデータ削除
6. H.264 / MP4で書き出し
7. iOS Share Sheet または保存

## プライバシー
動画ファイル自体をアプリのサーバーへアップロードするコードはありません。
v0.1ではFFmpegライブラリ/コアをjsDelivrから読み込むため、初回利用時はネット接続が必要です。
完全オフライン化は実機SMOKE TEST合格後にFFmpeg資産を同一オリジンへ置いてService Workerキャッシュ対象にします。

## MVP対象
- X用短尺ティザー
- 60秒以下推奨
- 350MB以下推奨
- 長尺動画は対象外

## 注意
iPhone実機のWebAssembly処理速度・メモリ消費は未測定。最初の合否は30秒の実動画SMOKE TESTで決めます。
