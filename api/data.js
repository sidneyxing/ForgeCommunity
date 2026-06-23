export const seedQuestions = [
  ["Alkitab", "Tokoh", "Siapakah yang memimpin Israel keluar dari Mesir?", "Yosua", "Musa", "Daud", "Samuel", "B"],
  ["Alkitab", "Tempat", "Di kota mana Daud lahir?", "Betlehem", "Yerikho", "Nazaret", "Kapernaum", "A"],
  ["Alkitab", "Perumpamaan", "Dalam perumpamaan orang Samaria yang baik hati, siapa yang menolong korban?", "Imam", "Lewi", "Orang Samaria", "Prajurit Roma", "C"],
  ["Refleksi & Karakter", "Integritas", "Dompet berisi uang jatuh di jalan. Tindakan terbaik adalah...", "Mengambil sebagian", "Mencari pemilik atau menyerahkan ke pihak aman", "Membiarkan saja", "Meminta teman menyimpan", "B"],
  ["Refleksi & Karakter", "Kejujuran", "Teman mengajak menyontek. Respons terbaik adalah...", "Ikut agar aman", "Menolak dan tetap mengerjakan sendiri", "Memberi jawaban sedikit", "Menyalahkan guru", "B"],
  ["Refleksi & Karakter", "Empati", "Teman sedang gagal. Respons paling empatik adalah...", "Mengejek", "Mendengar dulu dan menawarkan bantuan", "Membandingkan dengan diri sendiri", "Menyebarkan ceritanya", "B"],
  ["Kepemimpinan", "Teamwork", "Teamwork yang baik membutuhkan...", "Komunikasi jelas", "Ego paling kuat", "Tidak perlu evaluasi", "Saling diam", "A"],
  ["Kepemimpinan", "Decision Making", "Ketua tim melihat anggota pasif. Langkah pertama yang sehat adalah...", "Memarahi semua orang", "Mengambil semua tugas sendiri", "Memetakan tugas dan mengajak bicara", "Membubarkan tim", "C"],
  ["Logika & Matematika", "Pola", "2, 4, 8, 16, ... angka berikutnya?", "20", "24", "32", "36", "C"],
  ["Logika & Matematika", "Persentase", "20% dari 150 adalah...", "15", "25", "30", "45", "C"],
  ["Logika & Matematika", "Deduksi", "Semua A adalah B. Semua B adalah C. Maka...", "Semua A adalah C", "Semua C adalah A", "Tidak ada A yang C", "B bukan C", "A"],
  ["Pengetahuan Umum", "Sains", "Planet terdekat dari Matahari adalah...", "Venus", "Mars", "Merkurius", "Jupiter", "C"],
  ["Pengetahuan Umum", "Teknologi", "AI adalah singkatan dari...", "Automatic Internet", "Artificial Intelligence", "Advanced Input", "Applied Interface", "B"],
  ["Pengetahuan Umum", "Sejarah", "Proklamasi Indonesia terjadi pada tahun...", "1942", "1945", "1950", "1965", "B"],
  ["Geografi & Nations", "Ibukota", "Ibukota Jepang adalah...", "Kyoto", "Osaka", "Tokyo", "Nagoya", "C"],
  ["Geografi & Nations", "Indonesia", "Manado berada di provinsi...", "Sulawesi Utara", "Sulawesi Selatan", "Maluku", "Gorontalo", "A"],
  ["Keuangan Pribadi", "Budgeting", "Budgeting membantu kita untuk...", "Melacak dan mengatur pengeluaran", "Selalu membeli barang mahal", "Menghindari semua pemasukan", "Menghapus kebutuhan menabung", "A"],
  ["Keuangan Pribadi", "Inflasi", "Inflasi berarti...", "Harga umum cenderung naik", "Harga pasti turun", "Uang selalu bertambah", "Pajak hilang", "A"],
  ["Produktivitas & Habit", "Prioritas", "Jika banyak tugas, langkah terbaik adalah...", "Mulai dari yang paling penting dan mendesak", "Scroll dulu", "Menunda semua", "Kerjakan acak tanpa tujuan", "A"],
  ["Produktivitas & Habit", "Fokus", "Deep work berarti...", "Kerja fokus tanpa distraksi", "Kerja sambil banyak notifikasi", "Meeting tanpa agenda", "Menunda tugas sulit", "A"],
  ["Psikologi & Komunikasi", "Bias", "Confirmation bias adalah kecenderungan untuk...", "Mencari info yang mendukung keyakinan sendiri", "Selalu netral sempurna", "Tidak punya opini", "Menghafal angka", "A"],
  ["Psikologi & Komunikasi", "Emosi", "Cara sehat saat marah adalah...", "Pause, tarik napas, lalu bicara jelas", "Langsung meledak", "Menyimpan dendam", "Menyindir online", "A"],
  ["Situational Challenge", "Decision", "Kamu menemukan data laporan salah sebelum presentasi. Apa yang dilakukan?", "Diam saja", "Perbaiki dan beri tahu tim segera", "Salahkan komputer", "Hapus semua file", "B"],
  ["Situational Challenge", "Digital", "Ada berita heboh belum jelas sumbernya. Tindakan terbaik?", "Sebarkan cepat", "Cek sumber dulu", "Tambahkan drama", "Kirim ke semua grup", "B"],
  ["Situational Challenge", "Waktu", "Deadline dekat dan tugas belum selesai. Langkah sehat?", "Prioritaskan bagian penting dan komunikasikan progres", "Menghilang", "Menyalahkan situasi", "Mengerjakan hal tidak penting", "A"],
];

export function makeBadgeSeeds() {
  const badges = [
    ["first_duel", "First Duel", "Menyelesaikan duel pertama.", "Finish 1 duel", "gold", "I"],
    ["first_win", "First Victory", "Menang duel pertama kali.", "Win 1 duel", "gold", "V"],
    ["weekly_winner", "Weekly Champion", "Pernah rank 1 mingguan.", "Rank #1 weekly", "gold", "1"],
    ["weekly_second", "Silver Week", "Pernah rank 2 mingguan.", "Rank #2 weekly", "silver", "2"],
    ["weekly_third", "Bronze Week", "Pernah rank 3 mingguan.", "Rank #3 weekly", "bronze", "3"],
  ];
  const groups = [
    ["weekly_champion", "Weekly Champion", [5, 10, 25, 50, 100]],
    ["win", "Win", [5, 10, 25, 50, 100, 250, 500, 1000]],
    ["duel", "Duel", [5, 10, 25, 50, 100, 250, 500, 1000]],
    ["correct", "Correct Answer", [25, 50, 100, 250, 500, 1000, 2500, 5000]],
    ["fp", "Forge Points", [100, 500, 1000, 2500, 5000, 10000, 25000, 50000]],
    ["streak", "Fire Streak", [3, 7, 14, 30, 60, 100, 180, 365]],
    ["character", "Character Forge", [1, 5, 10, 25, 50]],
    ["leader", "Leadership Forge", [1, 5, 10, 25, 50]],
    ["bible", "Bible Forge", [1, 5, 10, 25, 50]],
    ["logic", "Logic Forge", [1, 5, 10, 25, 50]],
  ];
  for (const [key, label, values] of groups) {
    for (const value of values) {
      if (badges.length >= 100) break;
      badges.push([
        `${key}_${value}`,
        `${label} ${value}`,
        `Pencapaian ${label.toLowerCase()} tingkat ${value}.`,
        `${label} reaches ${value}`,
        value >= 100 ? "gold" : value >= 25 ? "silver" : "bronze",
        value >= 100 ? "G" : value >= 25 ? "S" : "B",
      ]);
    }
  }
  let i = 1;
  while (badges.length < 100) {
    badges.push([`mystery_${i}`, `Mystery Badge ${i}`, "Badge rahasia untuk event komunitas.", "Unlocked by admin event", "bronze", "?"]);
    i += 1;
  }
  return badges.map((badge, index) => ({
    id: badge[0],
    name: badge[1],
    description: badge[2],
    unlock_rule: badge[3],
    tier: badge[4],
    icon: badge[5],
    sort_order: index + 1,
  }));
}
