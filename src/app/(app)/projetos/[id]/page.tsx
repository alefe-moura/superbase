import { notFound } from 'next/navigation'
import { systemDb } from '@/lib/db'
import { getProjectWithMeta } from '@/lib/projects'
import { ProjectDetail } from './ProjectDetail'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const project = await getProjectWithMeta(id)
  if (!project) notFound()

  const { data: clients } = await systemDb()
    .from('clients')
    .select('*')
    .order('name')
    .returns<Client[]>()

  return <ProjectDetail project={project} clients={clients ?? []} />
}
