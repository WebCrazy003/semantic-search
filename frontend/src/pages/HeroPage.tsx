// frontend/src/pages/HeroPage.tsx
import {
  BulbOutlined,
  FileWordOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LockOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Button, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useLibraryContext } from '../app/LibraryContext'
import { CountUp } from '../components/CountUp'
import { HeroArt } from '../components/HeroArt'
import { useSettings } from '../settings/SettingsContext'

const { Title, Paragraph, Text } = Typography

const FEATURES = [
  {
    icon: <BulbOutlined />,
    title: 'Finds meaning, not words',
    body: 'Ask “how often should the seals be replaced” and it finds the maintenance interval, even when that passage never uses the word “often”.',
  },
  {
    icon: <GlobalOutlined />,
    title: 'Across languages',
    body: 'Chinese, Korean and English all search against all documents. A Korean question can find the answer inside a Chinese manual.',
  },
  {
    icon: <FileWordOutlined />,
    title: 'PDF and Word',
    body: 'PDFs whose text can be selected, and .docx files. Tables stay whole, and words split across lines or pages come out whole.',
  },
  {
    icon: <LockOutlined />,
    title: 'Nothing leaves this machine',
    body: 'No document, no search you type, and no usage data is ever sent anywhere. The service is reachable only from this computer.',
  },
]

export function HeroPage() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { documents, loaded, error } = useLibraryContext()

  const indexed = documents.filter((document) => document.status === 'indexed')
  const passages = indexed.reduce((total, document) => total + document.chunks, 0)
  // Nothing indexed means searching can only disappoint, so the first action changes.
  // Until the first load settles we do not know which case we are in, and guessing
  // makes the buttons swap under the pointer, so search leads until we do.
  const empty = loaded && indexed.length === 0

  return (
    <div className="page hero">
      <Row gutter={[32, 24]} align="middle">
        <Col xs={24} lg={13}>
          <Space orientation="vertical" size="middle" className="hero-copy">
            <Tag icon={<LockOutlined aria-hidden="true" />} color="success" className="hero-badge">
              Runs offline, on this machine
            </Tag>

            <Title className="hero-title">Find the right passage, not the right keyword.</Title>

            <Paragraph className="hero-lede">
              Search your own PDF and Word documents by what they mean. Everything — the
              documents, the language model and the index — stays on this computer.
            </Paragraph>

            <Space size="middle" wrap>
              {empty ? (
                <Button
                  type="primary"
                  size="large"
                  icon={<PlusOutlined aria-hidden="true" />}
                  className="hero-action"
                  onClick={() => navigate('/documents')}
                >
                  Add your first documents
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  icon={<SearchOutlined aria-hidden="true" />}
                  className="hero-action"
                  onClick={() => navigate('/search')}
                >
                  Search documents
                </Button>
              )}
              <Button
                size="large"
                icon={empty ? <SearchOutlined /> : <FolderOpenOutlined />}
                className="hero-action"
                onClick={() => navigate(empty ? '/search' : '/documents')}
              >
                {empty ? 'Search documents' : 'Manage documents'}
              </Button>
            </Space>

            {error && loaded ? (
              <Tag color="warning" className="hero-stat-warning">
                Backend not reachable — start the search service to see your library
              </Tag>
            ) : (
              <Space size="large" className="hero-stats">
                <Statistic
                  title="Documents searchable"
                  valueRender={() => <CountUp value={indexed.length} />}
                />
                <Statistic
                  title="Passages indexed"
                  valueRender={() => <CountUp value={passages} />}
                />
              </Space>
            )}
          </Space>
        </Col>

        <Col xs={24} lg={11} className="hero-art-col">
          <HeroArt accent={settings.accent} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="hero-features">
        {FEATURES.map((feature) => (
          <Col key={feature.title} xs={24} sm={12} xl={6}>
            <Card size="small" variant="outlined" className="feature-card">
              <div className="feature-icon" aria-hidden="true">
                {feature.icon}
              </div>
              <Text strong>{feature.title}</Text>
              <Paragraph type="secondary" className="feature-body">
                {feature.body}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}
