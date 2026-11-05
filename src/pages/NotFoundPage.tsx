import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFoundPage({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-bold text-primary tabular">{forbidden ? '403' : '404'}</p>
      <h1 className="text-xl font-bold">{forbidden ? 'Halaman ini tidak tersedia untuk peran Anda' : 'Halaman tidak ditemukan'}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {forbidden
          ? 'Hubungi Super Admin bila Anda memerlukan akses ke fitur ini.'
          : 'Alamat yang Anda buka tidak ada atau sudah dipindahkan.'}
      </p>
      <Button asChild><Link to="/">Kembali ke dashboard</Link></Button>
    </div>
  )
}
