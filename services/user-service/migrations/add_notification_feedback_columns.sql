-- 通知历史表新增哭声识别反馈和软删除字段
ALTER TABLE `notification_history`
ADD COLUMN IF NOT EXISTS `like_status` ENUM('none', 'liked', 'disliked') NOT NULL DEFAULT 'none' COMMENT '用户反馈状态',
ADD COLUMN IF NOT EXISTS `feedback_type` VARCHAR(50) NULL COMMENT '哭声识别反馈类型（hungry/hold/diaper/sleepy/gas）',
ADD COLUMN IF NOT EXISTS `feedback_text` VARCHAR(300) NULL COMMENT '用户自定义反馈文本',
ADD COLUMN IF NOT EXISTS `is_deleted` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '软删除标记';

-- 为软删除查询添加索引优化
CREATE INDEX IF NOT EXISTS `IDX_notification_history_user_not_deleted`
ON `notification_history` (`user_id`, `is_deleted`);
