import dayjs from "dayjs"
import { Tag } from "antd"

export const statusTagMap = {
  Pending: <Tag color="processing">Pending</Tag>,
  "Partially Complied": <Tag color="warning">Partially Complied</Tag>,
  Overdue: <Tag color="error">Overdue</Tag>,
  Complied: <Tag color="success">Complied</Tag>,
  Unknown: <Tag color="default">Unknown</Tag>,
}

export const additionalNoticeStatusTagMap = {
  Pending: <Tag color="processing">PENDING</Tag>,
  Overdue: <Tag color="error">Overdue</Tag>,
  Complied: <Tag color="success">Complied</Tag>,
  Unknown: <Tag color="default">Unknown</Tag>,
}

export const statusTagMapWithCount = {
  Pending: (count: number, onClick) => (
    <Tag color="processing" onClick={onClick}>
      {count} Pending
    </Tag>
  ),
  "Partially Complied": (count: number, onClick) => (
    <Tag color="warning" onClick={onClick}>
      {count} Partially Complied
    </Tag>
  ),
  Overdue: (count: number, onClick) => (
    <Tag color="error" onClick={onClick}>
      {count} Overdue
    </Tag>
  ),
  Complied: (count: number, onClick) => (
    <Tag color="success" onClick={onClick}>
      {count} Complied
    </Tag>
  ),
  Unknown: (count: number, onClick) => (
    <Tag color="default" onClick={onClick}>
      {count} Unknown
    </Tag>
  ),
}
