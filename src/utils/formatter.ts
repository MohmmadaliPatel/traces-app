import dayjs from "dayjs"

export const formatDate = (value) =>
  (value && value != "null" && dayjs(new Date(parseInt(value))).format("DD/MM/YYYY")) || ""

export const unixToFormattedDate = (unixTimestamp) =>
  (unixTimestamp && dayjs.unix(Number(unixTimestamp) / 1000).format("DD/MM/YYYY")) || "";
