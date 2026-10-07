export const STOCK_503_PAYLOAD = {
  success: false,
  status_code: 503,
  data: "<html>\r\n<head><title>503 Service Temporarily Unavailable</title></head>\r\n<body>\r\n<center><h1>503 Service Temporarily Unavailable</h1></center>\r\n</body>\r\n</html>\r\n",
  error: null,
};

export const STOCK_503_CALL_RESULT = {
  content: [{ type: "text", text: JSON.stringify(STOCK_503_PAYLOAD) }],
  isError: false,
  structuredContent: STOCK_503_PAYLOAD,
};

export const SIGNAL_ALT_ME_ERROR_CALL_RESULT = {
  content: [{ type: "text", text: '{"alt_me_error": ""}' }],
  isError: false,
};
