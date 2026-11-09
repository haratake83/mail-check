/* 画面の公開フラグ。履歴の照会UIと一覧リンクは、サーバができるまで出さない。利用規約の下書きは公開する。 */
(function (g) {
  g.MH_FLAGS = {
    FEATURE_HISTORY_PANEL: false,
    FEATURE_LIST_PUBLIC: false,
    FEATURE_TERMS_PUBLIC: true,
    FEATURE_ATTENTION: true
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
